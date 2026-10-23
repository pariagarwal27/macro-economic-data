import { getDb, getD1Database, executeSql } from "@/db";
import { ingestRuns } from "@/db/schema";
import {
  getEconomicCalendarRows,
  type ScheduledCalendarRow,
} from "@/lib/economic-calendar-db";
import { getActiveLiveSource, getCloudSourceConfig, getSourceConfig } from "./source-registry";
import { fetchMetricFromOfficialSource } from "./source-adapter";
import { processFetchedRelease } from "./release-processor";
import {
  claimRelease,
  getReleaseAttempt,
  markReleaseProcessed,
  markReleaseRetry,
  getPollState,
} from "./release-state";
import {
  logReleaseEvent,
  nextReleaseRetryAt,
  RELEASE_RETRY_COOLDOWN_MS,
  RELEASE_PROCESSING_LEASE_MS,
} from "./release-logging";
import { METRICS } from "@/catalog/metrics";
import type { ReleaseStage } from "./release-stages";
import { mapConcurrent } from "./release-concurrency";
import {
  CPI_CALENDAR_DEPENDENT_METRIC_IDS,
  cpiReleaseCandidates,
} from "./cpi-release-schedule";
import { isOnScheduledReleaseDay, retryableHistoricalSchedules } from "./release-schedule-retries";
import { createReleaseAttemptRunner } from "./release-attempt-runner";
import { retailReleaseCandidates, UK_RETAIL_RELEASE_IDS, isUkRetailReleasePeriod } from "@/lib/uk-retail";
import { persistUkRetailHistory } from "./uk-retail-history";

const attemptRunner = createReleaseAttemptRunner();

function sourceTimeZone(metricId: string) {
  if (
    metricId.startsWith("us-") ||
    metricId.startsWith("de-") ||
    metricId.startsWith("fr-") ||
    metricId.startsWith("it-") ||
    metricId.startsWith("es-")
  ) {
    return metricId.startsWith("us-")
      ? "America/New_York"
      : "Europe/Berlin";
  }
  if (metricId.startsWith("uk-")) return "Europe/London";
  if (metricId.startsWith("ea-")) return "Europe/Brussels";
  return "UTC";
}

function sourceConfig(metricId: string) {
  return getD1Database() ? getCloudSourceConfig(metricId) : getSourceConfig(metricId);
}

function localDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isDue(row: ScheduledCalendarRow, now: Date) {
  if (!row.metricId || !row.nextReleaseDate) return false;

  const config = sourceConfig(row.metricId);
  if (!config) return false;

  if (row.nextReleaseAt) {
    const t = Date.parse(row.nextReleaseAt);
    return Number.isFinite(t) && now.getTime() >= t;
  }

  // A date without an official time is intentionally treated as a release-day
  // window. We do not invent a time; we poll throughout that local date.
  const tz = sourceTimeZone(row.metricId);
  return localDate(now, tz) >= row.nextReleaseDate.slice(0, 10);
}

type Candidate = {
  metricId: string;
  scheduledAt: string;
  mode: "scheduled";
};

const PCE_RELEASE_METRICS = [
  "us-cleveland-median-pce", "us-cleveland-median-pce-mom",
  "us-dallas-trimmed-mean-pce", "us-dallas-trimmed-mean-pce-mom",
];

function pceReleaseCandidates(rows: ScheduledCalendarRow[], now: Date): Candidate[] {
  const schedule = rows.find(row =>
    Boolean(row.nextReleaseDate) &&
    (row.metricId === "us-pce" || row.metricId === "us-pce-yoy" ||
      row.metricId === "us-core-pce" || row.metricId === "us-core-pce-yoy" ||
      /personal income and outlays/i.test(row.metricName ?? ""))
  );
  if (!schedule || !schedule.metricId || !isDue(schedule, now)) return [];
  const scheduledAt = schedule.nextReleaseAt ?? schedule.nextReleaseDate!.slice(0, 10);
  const scheduled = Date.parse(schedule.nextReleaseAt ?? `${schedule.nextReleaseDate!.slice(0, 10)}T23:59:59Z`);
  if (now.getTime() - scheduled > 3 * 24 * 60 * 60_000) return [];
  return PCE_RELEASE_METRICS.map(metricId => ({ metricId, scheduledAt, mode: "scheduled" as const }));
}

async function buildCandidates(now: Date): Promise<Candidate[]> {
  const calendarRows = await getEconomicCalendarRows();
  const historyRows = await getEconomicCalendarRows({ history: true });
  const currentAndHistoricalRows = [...calendarRows, ...retryableHistoricalSchedules(calendarRows, historyRows, now)];
  // Keep polling a release for up to three days after its date even if the
  // calendar has already rolled that metric forward to its next release.
  const dueRows = currentAndHistoricalRows;
  const candidates: Candidate[] = [];

  for (const row of dueRows) {
    // These metrics share the official BLS CPI release, but some have no
    // calendar row of their own (or a stale Cleveland Fed date). Their
    // schedule is derived from the BLS CPI event below.
    if (CPI_CALENDAR_DEPENDENT_METRIC_IDS.has(row.metricId) || UK_RETAIL_RELEASE_IDS.includes(row.metricId)) continue;
    if (!row.metricId || !isDue(row, now)) continue;
    const scheduled = Date.parse(row.nextReleaseAt ?? `${row.nextReleaseDate!.slice(0, 10)}T23:59:59Z`);
    if (now.getTime() - scheduled > 3 * 24 * 60 * 60_000) continue;

    candidates.push({
      metricId: row.metricId,
      // Exact timestamp when available; date-only releases use the date as
      // the durable claim key. The next calendar refresh will create a new
      // key for the next release.
      scheduledAt: row.nextReleaseAt ?? row.nextReleaseDate!.slice(0, 10),
      mode: "scheduled",
    });
  }

  candidates.push(...cpiReleaseCandidates(calendarRows, now));
  candidates.push(...pceReleaseCandidates(calendarRows, now));
  candidates.push(...retailReleaseCandidates(currentAndHistoricalRows, now));

  // Keep calendar order (release date ascending) but de-duplicate metric IDs.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.metricId)) return false;
    seen.add(candidate.metricId);
    return true;
  });
}

/** Read-only preview of scheduled releases that would be eligible at `now`. */
export async function getDueReleaseCandidates(now = new Date()) {
  return buildCandidates(now);
}

async function processCandidate(candidate: Candidate) {
  const claimed = await claimRelease(
    candidate.metricId,
    candidate.scheduledAt
  );

  if (!claimed) {
    const metric = METRICS.find((item) => item.id === candidate.metricId);
    logReleaseEvent({
      event: "attempt_skipped",
      metricId: candidate.metricId,
      metricName: metric?.shortName ?? metric?.name ?? candidate.metricId,
      scheduledAt: candidate.scheduledAt,
      mode: candidate.mode,
      reason: "Another worker owns this attempt, or it is already complete.",
    });
    return {
      metricId: candidate.metricId,
      status: "skipped",
      reason: "already-processing-or-processed",
      retryEligible: false,
    };
  }

  const metric = METRICS.find((item) => item.id === candidate.metricId);
  const config = sourceConfig(candidate.metricId);
  const attemptInfo = await getReleaseAttempt(candidate.metricId, candidate.scheduledAt);
  const attemptStartedAt = attemptInfo.startedAt ?? new Date().toISOString();
  const context = {
    metricId: candidate.metricId,
    metricName: metric?.shortName ?? metric?.name ?? candidate.metricId,
    region: metric?.region,
    source: getActiveLiveSource(candidate.metricId, Boolean(getD1Database()))?.toUpperCase()
      ?? metric?.source?.toUpperCase(),
    seriesId: metric?.seriesId,
    adapter: config?.adapter,
    sourceSeries: config?.sourceId,
    scheduledAt: candidate.scheduledAt,
    mode: candidate.mode,
    attempt: attemptInfo.attempt,
  };

  logReleaseEvent({
    event: "attempt_started",
    ...context,
    at: attemptStartedAt,
    action: "fetch_official_source",
  });

  let stage = "source_fetch";
  const fetchStartedMs = Date.now();
  try {
    const fetched = await fetchMetricFromOfficialSource(candidate.metricId);
    const isUkRetail = UK_RETAIL_RELEASE_IDS.includes(candidate.metricId);
    const result = isUkRetail && fetched && !isUkRetailReleasePeriod(candidate.scheduledAt, fetched.periodDate) ? null : fetched;
    const sourceFetchMs = Date.now() - fetchStartedMs;

    logReleaseEvent({
      event: "source_response",
      ...context,
      fetched: Boolean(result),
      period: result?.periodDate ?? null,
      value: result?.value ?? null,
      sourceFetchMs,
      outcome: result ? "value_returned" : "no_new_value_returned",
    });

    if (!result) {
      await markReleaseRetry(
        candidate.metricId,
        candidate.scheduledAt,
        "Official source has not published a new value yet."
      );
      logReleaseEvent({
        event: "attempt_retry_scheduled",
        ...context,
        status: "waiting_for_source",
        reason: "Official source has not published a new value yet.",
        retryEligibleAt: nextReleaseRetryAt(new Date().toISOString(), RELEASE_RETRY_COOLDOWN_MS),
        retryDelaySeconds: RELEASE_RETRY_COOLDOWN_MS / 1000,
        elapsedMs: Date.now() - Date.parse(attemptStartedAt),
      });
      return {
        metricId: candidate.metricId,
        status: "waiting",
        retryEligible: true,
      };
    }

    stage = "database_update";
    if (isUkRetail) {
      const history = (result as { history?: { date: string; value: number }[] }).history;
      if (!history?.length || history.at(-1)?.date !== result.periodDate || history.at(-1)?.value !== result.value) {
        throw new Error("ONS retail release did not include a matching published history");
      }
      // Publish one complete observation vintage before recording release
      // metadata. A failed batch leaves the preceding vintage intact.
      await persistUkRetailHistory(candidate.metricId, history, result.releasedAt ?? new Date().toISOString());
    }
    const processed = await processFetchedRelease({
      metricId: candidate.metricId,
      scheduledAt: candidate.scheduledAt,
      result: {
        periodDate: result.periodDate,
        value: result.value,
        rawValue: result.rawValue,
        releasedAt: result.releasedAt,
        releaseStage: (result as { releaseStage?: ReleaseStage }).releaseStage,
        note: result.note,
      },
    });

    const alreadyRecorded = processed.reason === "already-recorded";
    const confirmedUnchanged = processed.reason === "confirmed-unchanged";
    if (processed.updated || alreadyRecorded || confirmedUnchanged) {
  if (isUkRetail) {
    // Release metadata persistence may append a vintage of the same newest
    // observation. The canonical ONS chart history keeps one row per month;
    // the separate releases table retains its publication history.
    await executeSql({ sql: 'DELETE FROM observations WHERE metric_id=? AND date=? AND is_latest=0', args: [candidate.metricId, result.periodDate] });
  }
  /*
   * The source returned a genuinely new observation, or an earlier refresh
   * already persisted this scheduled release.
   *
   * Only a committed value completes the scheduled release.
   */
  await markReleaseProcessed(
    candidate.metricId,
    candidate.scheduledAt,
    'releaseId' in processed ? processed.releaseId : null
  );
} else {
  /*
   * Important:
   *
   * no-new-release
   * source-period-older-than-db
   * and other non-updated states
   *
   * must remain retryable.
   *
   * This is what allows the worker to keep checking a provider
   * that publishes a few seconds/minutes after the scheduled time.
   */
  await markReleaseRetry(
    candidate.metricId,
    candidate.scheduledAt,
    processed.reason ?? "Release was not processed."
  );
}

    const successfulCheck = processed.updated || alreadyRecorded || confirmedUnchanged;
    const retryEligible = !successfulCheck;
    logReleaseEvent({
      event: processed.updated ? "attempt_updated" : successfulCheck ? "attempt_checked_unchanged" : "attempt_retry_scheduled",
      ...context,
      status: processed.updated ? "updated" : alreadyRecorded ? "already_recorded" : confirmedUnchanged ? "confirmed_unchanged" : "no_new_release_yet",
      fetchedPeriod: result.periodDate,
      fetchedValue: result.value,
      previousPeriod: "latestDbPeriod" in processed ? processed.latestDbPeriod : null,
      previousValue: "latestDbValue" in processed ? processed.latestDbValue : null,
      databaseUpdated: processed.updated,
      releaseId: "releaseId" in processed ? processed.releaseId ?? null : null,
      reason: processed.reason ?? null,
      retryEligibleAt: retryEligible
        ? nextReleaseRetryAt(new Date().toISOString(), RELEASE_RETRY_COOLDOWN_MS)
        : null,
      retryDelaySeconds: retryEligible ? RELEASE_RETRY_COOLDOWN_MS / 1000 : null,
      elapsedMs: Date.now() - Date.parse(attemptStartedAt),
    });

    return {
      metricId: candidate.metricId,
      status: "checked",
      processed,
      mode: candidate.mode,
      retryEligible,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    await markReleaseRetry(
      candidate.metricId,
      candidate.scheduledAt,
      message
    );

    logReleaseEvent({
      event: "attempt_failed",
      ...context,
      stage,
      status: "error",
      error: message,
      retryEligibleAt: nextReleaseRetryAt(new Date().toISOString(), RELEASE_RETRY_COOLDOWN_MS),
      retryDelaySeconds: RELEASE_RETRY_COOLDOWN_MS / 1000,
      elapsedMs: Date.now() - Date.parse(attemptStartedAt),
    });

    return {
      metricId: candidate.metricId,
      status: "error",
      error: message,
      mode: candidate.mode,
      retryEligible: true,
    };
  }
}

export async function dispatchDueReleases(options?: {
  metricIds?: string[];
  /** Infinity for the local worker; bounded to the invocation window in cron. */
  retryForMs?: number;
}) {
  const now = new Date();
  const retryDeadline = now.getTime() + (options?.retryForMs ?? 0);
  const allCandidates = await getDueReleaseCandidates(now);
  const pollState = await getPollState();
  const candidates = allCandidates.filter(candidate => {
    if (options?.metricIds && !options.metricIds.includes(candidate.metricId)) return false;
    if (attemptRunner.isRunning(candidate.metricId)) return false;
    const state = pollState.get(candidate.metricId);
    if (!state) return true;
    if (state.scheduledAt === candidate.scheduledAt && state.status === "processed") return false;
    return state.status !== "processing" ||
      now.getTime() - Date.parse(state.lastAttemptAt) >= RELEASE_PROCESSING_LEASE_MS;
  }).sort((a, b) => {
    return (pollState.get(a.metricId)?.lastAttemptAt ?? "").localeCompare(pollState.get(b.metricId)?.lastAttemptAt ?? "");
  });
  // Start every eligible release request together. This avoids delaying a
  // metric behind earlier candidates when multiple releases share a timestamp.
  const results = (await mapConcurrent(candidates, candidate => attemptRunner.run(
    candidate.metricId,
    () => processCandidate(candidate),
    async () => {
      if (candidate.mode !== "scheduled" || Date.now() >= retryDeadline ||
          !isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, new Date())) return false;
      await new Promise(resolve => setTimeout(resolve, RELEASE_RETRY_COOLDOWN_MS));
      return Date.now() < retryDeadline && isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, new Date());
    },
  ))).filter(result => result !== null);

  if (getD1Database()) {
    const outcomes = results as { metricId: string; status: string; error?: string; processed?: { updated: boolean } }[];
    const errors = outcomes.filter(item => item.status === "error");
    await getDb().insert(ingestRuns).values({
      startedAt: now.toISOString(), finishedAt: new Date().toISOString(),
      mode: "cloud-release", status: errors.length ? "partial" : "ok",
      metricsProcessed: outcomes.filter(item => item.status !== "skipped").length,
      observationsUpserted: outcomes.filter(item => item.processed?.updated).length,
      error: errors.length ? JSON.stringify(errors.map(item => ({ metricId: item.metricId, error: item.error }))).slice(0, 2000) : null,
    });
  }

  return {
    checkedAt: now.toISOString(),
    scheduledDue: candidates.filter((x) => x.mode === "scheduled").length,
    safetyDue: 0,
    eligible: candidates.length,
    attempted: results.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { status?: string }).status !== "skipped"
    ).length,
    results,
  };
}
