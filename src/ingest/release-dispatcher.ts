import { getDb, executeSql } from "@/db";
import {
  getEconomicCalendarRows,
  type ScheduledCalendarRow,
} from "@/lib/economic-calendar-db";
import { getActiveLiveSource, getSourceConfig } from "./source-registry";
import { fetchMetricFromOfficialSource } from "./source-adapter";
import { processFetchedRelease } from "./release-processor";
import {
  claimRelease,
  getReleaseAttempt,
  markReleaseProcessed,
  markReleaseExpired,
  markReleaseRetry,
  getPollState,
} from "./release-state";
import {
  logReleaseEvent,
  nextReleaseRetryAt,
  RELEASE_PROCESSING_LEASE_MS,
} from "./release-logging";
import { METRICS } from "@/catalog/metrics";
import { eurostatExpectedPublicationPeriod, eurostatScheduledReleaseStage, type ReleaseStage } from "./release-stages";
import { missingEurostatGdpScheduleFallbacks } from "./eurostat-release-schedules";
import { fetchEurostatGdpFlashRelease } from "./eurostat-gdp-flash";
import { mapConcurrent } from "./release-concurrency";
import {
  CPI_CALENDAR_DEPENDENT_METRIC_IDS,
  cpiReleaseCandidates,
} from "./cpi-release-schedule";
import { isOnScheduledReleaseDay, isRecoverableFedMetric, retryableHistoricalSchedules } from "./release-schedule-retries";
import { createReleaseAttemptRunner } from "./release-attempt-runner";
import { retailReleaseCandidates, UK_RETAIL_RELEASE_IDS, isUkRetailReleasePeriod } from "@/lib/uk-retail";
import { persistUkRetailHistory } from "./uk-retail-history";
import { contributionMetricIds } from "@/lib/inflation-contributions";
import { inheritSharedReleaseSchedules } from "@/lib/economic-calendar-view";
import { dashboardReleaseTarget } from "@/lib/release-notifications";
import { PCE_COMPONENTS } from "./us-inflation";
import { PCE_EXPENDITURE_LINES } from "@/lib/pce-expenditure";
import { expectedPcePeriod, isPceMonthlySeries } from "@/lib/pce-release";
import { persistPceHistoryRevisions, type PceHistoryPoint } from "./pce-history";
import { exactReleaseTimestamp, isWithinReleaseFetchWindow, RELEASE_PREPARE_LEAD_MS, releaseRetryDelayMs, waitForReleaseInstant } from "./release-clock";

function withinCandidateFetchWindow(metricId: string, scheduledAt: string, now = Date.now(), lead = 0, timeZone = "UTC") {
  if (!isRecoverableFedMetric(metricId)) return isWithinReleaseFetchWindow(scheduledAt, now, lead, timeZone);
  const instant = exactReleaseTimestamp(scheduledAt);
  return isOnScheduledReleaseDay(metricId, scheduledAt, new Date(now)) && (instant == null || now >= instant - lead);
}
const attemptRunner = createReleaseAttemptRunner();
const dashboardReleaseMetrics = METRICS.filter(metric => dashboardReleaseTarget(metric.id));

function withDashboardReleaseSchedules(rows: ScheduledCalendarRow[]) {
  const inherited = inheritSharedReleaseSchedules(rows, dashboardReleaseMetrics);
  const dashboardIds = new Set(inherited.map(row => row.metricId));
  return [...rows.filter(row => !dashboardIds.has(row.metricId)), ...inherited];
}

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
  return getSourceConfig(metricId);
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
    return Number.isFinite(t) && now.getTime() >= t &&
      isOnScheduledReleaseDay(row.metricId, row.nextReleaseAt, now);
  }

  // A date without an official time is intentionally treated as a release-day
  // window. We do not invent a time; we poll throughout that local date.
  const tz = sourceTimeZone(row.metricId);
  return isOnScheduledReleaseDay(row.metricId, row.nextReleaseDate.slice(0, 10), now);
}

type Candidate = {
  metricId: string;
  scheduledAt: string;
  mode: "scheduled";
  releaseStage?: ReleaseStage;
  expectedPeriodDate?: string;
};

const PCE_RELEASE_METRICS = [
  "us-pce", "us-pce-yoy", "us-pce-mom",
  "us-core-pce", "us-core-pce-yoy", "us-core-pce-mom",
  "us-core-pce-ex-housing",
  ...PCE_COMPONENTS.map(([metricId]) => metricId),
  "us-pce-housing", // Core view uses the BEA housing series instead of housing and utilities.
  ...Object.keys(PCE_EXPENDITURE_LINES),
  "us-cleveland-median-pce", "us-cleveland-median-pce-mom",
  "us-dallas-trimmed-mean-pce", "us-dallas-trimmed-mean-pce-mom",
];

const CPI_FAMILY_DEPENDENT_METRIC_IDS = new Set([
  ...CPI_CALENDAR_DEPENDENT_METRIC_IDS,
  ...contributionMetricIds().filter(id => id.startsWith("uk-") || id.startsWith("ea-")),
]);

function inflationFamilyReleaseCandidates(rows: ScheduledCalendarRow[], now: Date, region: "UK" | "EA"): Candidate[] {
  const prefix = region.toLowerCase();
  const schedule = rows.find(row =>
    (row.metricId === `${prefix}-cpi-yoy` || row.metricId === `${prefix}-cpih-yoy` || row.metricId === `${prefix}-hicp-yoy`) && isDue(row, now)
  );
  if (!schedule?.metricId) return [];
  const scheduledAt = schedule.nextReleaseAt ?? schedule.nextReleaseDate?.slice(0, 10);
  if (!scheduledAt) return [];
  return [...CPI_FAMILY_DEPENDENT_METRIC_IDS]
    .filter(metricId => metricId.startsWith(`${prefix}-`) && sourceConfig(metricId))
    .map(metricId => ({ metricId, scheduledAt, mode: "scheduled" as const,
      releaseStage: eurostatScheduledReleaseStage(metricId, schedule.officialEvidence),
      expectedPeriodDate: eurostatExpectedPublicationPeriod(metricId, scheduledAt) }));
}

function pceReleaseCandidates(rows: ScheduledCalendarRow[], now: Date): Candidate[] {
  const schedule = rows.find(row =>
    Boolean(row.nextReleaseDate) &&
    (row.metricId === "us-pce" || row.metricId === "us-pce-yoy" ||
      row.metricId === "us-core-pce" || row.metricId === "us-core-pce-yoy" ||
      /personal income and outlays/i.test(row.metricName ?? ""))
  );
  if (!schedule || !schedule.metricId || !isDue(schedule, now)) return [];
  const scheduledAt = schedule.nextReleaseAt ?? schedule.nextReleaseDate!.slice(0, 10);
  return PCE_RELEASE_METRICS.filter(metricId => sourceConfig(metricId))
    .map(metricId => ({ metricId, scheduledAt, mode: "scheduled" as const }));
}

function ismEmploymentReleaseCandidates(rows: ScheduledCalendarRow[], now: Date): Candidate[] {
  const scheduleLinks = [
    ["us-ism-manufacturing-pmi", "us-ism-manufacturing-employment"],
    ["us-ism-services-pmi", "us-ism-services-employment"],
  ] as const;
  return scheduleLinks.flatMap(([scheduleMetricId, metricId]) => {
    const schedule = rows.find(row => row.metricId === scheduleMetricId && row.nextReleaseDate);
    if (!schedule || !sourceConfig(metricId)) return [];
    // The hosted runtime intentionally skips its local-only LSEG headline PMI
    // adapter. Check the derived official ISM input's schedule instead.
    if (!isDue({ ...schedule, metricId }, now)) return [];
    const scheduledAt = schedule.nextReleaseAt ?? schedule.nextReleaseDate!.slice(0, 10);
    return [{ metricId, scheduledAt, mode: "scheduled" as const }];
  });
}

async function buildCandidates(now: Date, prepareAheadMs = 0): Promise<Candidate[]> {
  const scanAt = new Date(now.getTime() + prepareAheadMs);
  const calendarRows = withDashboardReleaseSchedules(await getEconomicCalendarRows());
  const historyRows = withDashboardReleaseSchedules(await getEconomicCalendarRows({ history: true }));
  const currentAndHistoricalRows = [
    ...calendarRows,
    ...retryableHistoricalSchedules(calendarRows, historyRows, now),
  ];
  currentAndHistoricalRows.push(...missingEurostatGdpScheduleFallbacks(currentAndHistoricalRows));
  // The workbook publishes monthly and annual rates together, even when the
  // calendar has only a dated annual row and a no-date monthly placeholder.
  for (const row of [...currentAndHistoricalRows]) {
    if (!/^(?:us-(?:core-)?sticky-cpi|us-flexible-cpi|us-cleveland-(?:median-cpi|trimmed-cpi))$/.test(row.metricId)) continue;
    const metricId = `${row.metricId}-mom`;
    if (!currentAndHistoricalRows.some(peer => peer.metricId === metricId && peer.nextReleaseDate === row.nextReleaseDate)) {
      currentAndHistoricalRows.push({ ...row, metricId });
    }
  }

  const dueRows = currentAndHistoricalRows;
  const candidates: Candidate[] = [];

  for (const row of dueRows) {
    // These metrics share the official BLS CPI release, but some have no
    // calendar row of their own (or a stale Cleveland Fed date). Their
    // schedule is derived from the BLS CPI event below.
    if ((CPI_FAMILY_DEPENDENT_METRIC_IDS.has(row.metricId) && !isRecoverableFedMetric(row.metricId)) || UK_RETAIL_RELEASE_IDS.includes(row.metricId)) continue;
    if (!row.metricId || !isDue(row, scanAt)) continue;
    candidates.push({
      metricId: row.metricId,
      // Exact timestamp when available; date-only releases use the date as
      // the durable claim key. The next calendar refresh will create a new
      // key for the next release.
      scheduledAt: row.nextReleaseAt ?? row.nextReleaseDate!.slice(0, 10),
      mode: "scheduled",
      releaseStage: eurostatScheduledReleaseStage(row.metricId, row.officialEvidence),
      expectedPeriodDate: eurostatExpectedPublicationPeriod(row.metricId, row.nextReleaseAt ?? row.nextReleaseDate!.slice(0, 10)),
    });
  }

  candidates.push(...cpiReleaseCandidates(currentAndHistoricalRows, scanAt));
  candidates.push(...pceReleaseCandidates(calendarRows, scanAt));
  candidates.push(...ismEmploymentReleaseCandidates(calendarRows, scanAt));
  candidates.push(...inflationFamilyReleaseCandidates(calendarRows, scanAt, "UK"));
  candidates.push(...inflationFamilyReleaseCandidates(calendarRows, scanAt, "EA"));
  candidates.push(...retailReleaseCandidates(currentAndHistoricalRows, scanAt));

  // Keep calendar order (release date ascending) but de-duplicate metric IDs.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, now)) return false;
    if (exactReleaseTimestamp(candidate.scheduledAt) == null) {
      if (candidate.scheduledAt.includes("T")) {
        const ambiguousTime = Date.parse(candidate.scheduledAt);
        if (!Number.isFinite(ambiguousTime) || ambiguousTime > now.getTime()) return false;
      } else if (localDate(now, sourceTimeZone(candidate.metricId)) < candidate.scheduledAt.slice(0, 10)) return false;
    }
    if (seen.has(candidate.metricId)) return false;
    seen.add(candidate.metricId);
    return true;
  });
}

/** Read-only preview of scheduled releases that would be eligible at `now`. */
export async function getDueReleaseCandidates(now = new Date(), prepareAheadMs = 0) {
  return buildCandidates(now, prepareAheadMs);
}

async function processCandidate(candidate: Candidate) {
  // A cron tick can discover a future release up to a minute ahead. Do the
  // database preparation at T-5s, then keep the request itself armed for T.
  await waitForReleaseInstant(candidate.scheduledAt, undefined, RELEASE_PREPARE_LEAD_MS);
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
    source: getActiveLiveSource(candidate.metricId)?.toUpperCase()
      ?? metric?.source?.toUpperCase(),
    seriesId: metric?.seriesId,
    adapter: config?.adapter,
    sourceSeries: config?.sourceId,
    scheduledAt: candidate.scheduledAt,
    mode: candidate.mode,
    attempt: attemptInfo.attempt,
  };

  logReleaseEvent({
    event: "release_armed",
    ...context,
    at: attemptStartedAt,
    action: "waiting_for_publication_instant",
  });

  let stage = "source_fetch";
  try {
    await waitForReleaseInstant(candidate.scheduledAt);
    const fetchTime = new Date();
    if (!isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, fetchTime) ||
        !withinCandidateFetchWindow(candidate.metricId, candidate.scheduledAt, fetchTime.getTime(), 0, sourceTimeZone(candidate.metricId))) {
      await markReleaseExpired(candidate.metricId, candidate.scheduledAt);
      logReleaseEvent({ event: "release_window_expired", ...context, window: "release-day",
        reason: "The local release day has ended." });
      return { metricId: candidate.metricId, status: "expired", retryEligible: false };
    }
    const fetchStartedMs = Date.now();
    const request = candidate.releaseStage === "flash" && candidate.expectedPeriodDate &&
      (candidate.metricId === "ea-gdp-qoq" || candidate.metricId === "ea-gdp-yoy")
      ? fetchEurostatGdpFlashRelease(candidate.metricId, candidate.expectedPeriodDate, candidate.scheduledAt)
          .then(result => result ?? fetchMetricFromOfficialSource(candidate.metricId))
      : fetchMetricFromOfficialSource(candidate.metricId);
    logReleaseEvent({ event: "attempt_started", ...context, at: new Date(fetchStartedMs).toISOString(), action: "fetch_official_source",
      schedulingDelayMs: exactReleaseTimestamp(candidate.scheduledAt) == null ? null : Math.max(0, fetchStartedMs - exactReleaseTimestamp(candidate.scheduledAt)!),
    });
    const fetched = await request;
    const responseTime = new Date();
    if (!isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, responseTime) ||
        !withinCandidateFetchWindow(candidate.metricId, candidate.scheduledAt, responseTime.getTime(), 0, sourceTimeZone(candidate.metricId))) {
      await markReleaseExpired(candidate.metricId, candidate.scheduledAt);
      logReleaseEvent({ event: "release_window_expired", ...context, window: "release-day",
        reason: "The source response arrived after the local release day." });
      return { metricId: candidate.metricId, status: "expired", retryEligible: false };
    }
    const isUkRetail = UK_RETAIL_RELEASE_IDS.includes(candidate.metricId);
    const metric = METRICS.find(metric => metric.id === candidate.metricId);
    const isPce = Boolean(metric && isPceMonthlySeries(metric));
    const expectedPce = isPce ? expectedPcePeriod(candidate.scheduledAt) : null;
    const result = fetched && ((isUkRetail && !isUkRetailReleasePeriod(candidate.scheduledAt, fetched.periodDate)) ||
      (expectedPce && fetched.periodDate < expectedPce) ||
      (candidate.expectedPeriodDate && fetched.periodDate < candidate.expectedPeriodDate)) ? null : fetched;
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
        retryEligibleAt: nextReleaseRetryAt(new Date().toISOString(), releaseRetryDelayMs(config?.adapter, candidate.scheduledAt)),
        retryDelaySeconds: releaseRetryDelayMs(config?.adapter, candidate.scheduledAt) / 1000,
        elapsedMs: Date.now() - Date.parse(attemptStartedAt),
      });
      return {
        metricId: candidate.metricId,
        status: "waiting",
        retryEligible: true,
      };
    }

    stage = "database_update";
    if (isPce) {
      const history = (result as { history?: PceHistoryPoint[] }).history;
      if (!history?.length || history.at(-1)?.date !== result.periodDate || history.at(-1)?.value !== result.value) {
        throw new Error("BEA PCE release did not include matching index-vintage history");
      }
      await persistPceHistoryRevisions(candidate.metricId, history);
    }
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
        releaseStage: candidate.releaseStage ?? (result as { releaseStage?: ReleaseStage }).releaseStage,
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
        ? nextReleaseRetryAt(new Date().toISOString(), releaseRetryDelayMs(config?.adapter, candidate.scheduledAt))
        : null,
      retryDelaySeconds: retryEligible ? releaseRetryDelayMs(config?.adapter, candidate.scheduledAt) / 1000 : null,
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
      retryEligibleAt: nextReleaseRetryAt(new Date().toISOString(), releaseRetryDelayMs(config?.adapter, candidate.scheduledAt)),
      retryDelaySeconds: releaseRetryDelayMs(config?.adapter, candidate.scheduledAt) / 1000,
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
  prepareAheadMs?: number;
  /** Infinity for the local worker; bounded to the invocation window in cron. */
  retryForMs?: number;
}) {
  const now = new Date();
  const prepareAheadMs = Math.max(0, Math.min(options?.prepareAheadMs ?? 0, 65_000));
  const retryDeadline = now.getTime() + prepareAheadMs + (options?.retryForMs ?? 0);
  const allCandidates = await getDueReleaseCandidates(now, prepareAheadMs);
  const pollState = await getPollState();
  const candidates = allCandidates.filter(candidate => {
    if (options?.metricIds && !options.metricIds.includes(candidate.metricId)) return false;
    if (attemptRunner.isRunning(candidate.metricId)) return false;
    const state = pollState.get(candidate.metricId);
    const releaseInstant = exactReleaseTimestamp(candidate.scheduledAt);
    const upcomingWithinPrepareWindow = releaseInstant != null &&
      releaseInstant >= now.getTime() && releaseInstant - now.getTime() <= prepareAheadMs;
    if (!upcomingWithinPrepareWindow && !isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, now)) return false;
    if (!withinCandidateFetchWindow(candidate.metricId, candidate.scheduledAt, now.getTime(), prepareAheadMs, sourceTimeZone(candidate.metricId))) {
      return false;
    }
    if (!state) return true;
    if (state.scheduledAt === candidate.scheduledAt && (state.status === "processed" || state.status === "expired")) return false;
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
      if (candidate.mode !== "scheduled" || Date.now() >= retryDeadline) return false;
      if (!isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, new Date()) ||
          !withinCandidateFetchWindow(candidate.metricId, candidate.scheduledAt, Date.now(), 0, sourceTimeZone(candidate.metricId))) {
        await markReleaseExpired(candidate.metricId, candidate.scheduledAt);
        logReleaseEvent({ event: "release_window_expired", metricId: candidate.metricId,
          scheduledAt: candidate.scheduledAt, window: "release-day" });
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, releaseRetryDelayMs(sourceConfig(candidate.metricId)?.adapter, candidate.scheduledAt)));
      const afterRetryWait = new Date();
      const stillWithinWindow = isOnScheduledReleaseDay(candidate.metricId, candidate.scheduledAt, afterRetryWait) &&
        withinCandidateFetchWindow(candidate.metricId, candidate.scheduledAt, afterRetryWait.getTime(), 0, sourceTimeZone(candidate.metricId));
      if (!stillWithinWindow) {
        await markReleaseExpired(candidate.metricId, candidate.scheduledAt);
        logReleaseEvent({ event: "release_window_expired", metricId: candidate.metricId,
          scheduledAt: candidate.scheduledAt, window: "release-day" });
      }
      return Date.now() < retryDeadline && stillWithinWindow;
    },
  ))).filter(result => result !== null);

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
