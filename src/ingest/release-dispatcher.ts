import { getDb, getD1Database } from "@/db";
import { ingestRuns, metrics } from "@/db/schema";
import {
  getEconomicCalendarRows,
  type ScheduledCalendarRow,
} from "@/lib/economic-calendar-db";
import { getCloudSourceConfig, getSourceConfig } from "./source-registry";
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
} from "./release-logging";
import { METRICS } from "@/catalog/metrics";
import type { MetricDef } from "@/catalog/metrics";

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

function safetyIntervalMs(metric: MetricDef) {
  if (getD1Database()) {
    // A rolling sweep still works after the supplied calendar's dates expire.
    if (metric.frequency === "daily" || metric.frequency === "hourly") return 60 * 60_000;
    return metric.frequency === "annual" ? 24 * 60 * 60_000 : 6 * 60 * 60_000;
  }
  switch (metric.frequency) {
    case "daily":
      return 60 * 60 * 1000;
    case "hourly":
      return 15 * 60 * 1000;
    case "weekly":
      return 12 * 60 * 60 * 1000;
    case "monthly":
      return 24 * 60 * 60 * 1000;
    case "quarterly":
      return 3 * 24 * 60 * 60 * 1000;
    case "annual":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

function safetyBucket(metric: MetricDef, nowMs: number) {
  const interval = safetyIntervalMs(metric);
  return Math.floor(nowMs / interval) * interval;
}

export function isSafetyDue(
  metric: MetricDef,
  calendarRow: ScheduledCalendarRow | undefined,
  lastIngestedAt: string | null,
  nowMs: number
) {
  // A valid official calendar date takes precedence. Safety polling is only
  // for metrics whose provider has not published a future schedule.
  if (calendarRow?.nextReleaseDate && metric.frequency !== "daily" && metric.frequency !== "hourly") {
    const scheduled = Date.parse(calendarRow.nextReleaseAt ?? `${calendarRow.nextReleaseDate.slice(0, 10)}T23:59:59Z`);
    if (Number.isFinite(scheduled) && nowMs - scheduled <= 3 * 24 * 60 * 60_000) return false;
  }

  const lastMs = lastIngestedAt ? Date.parse(lastIngestedAt) : NaN;
  const interval = safetyIntervalMs(metric);

  return !Number.isFinite(lastMs) || nowMs - lastMs >= interval;
}

function safetyScheduledAt(metric: MetricDef, nowMs: number) {
  return `safety:${metric.id}:${safetyBucket(metric, nowMs)}`;
}

type Candidate = {
  metricId: string;
  scheduledAt: string;
  mode: "scheduled" | "safety";
};

async function buildCandidates(now: Date): Promise<Candidate[]> {
  const calendarRows = await getEconomicCalendarRows();
  const byMetric = new Map(
    calendarRows
      .filter((row) => row.metricId)
      .map((row) => [row.metricId, row])
  );

  const db = getDb();
  const catalogRows = await db
    .select({
      id: metrics.id,
      lastIngestedAt: metrics.lastIngestedAt,
    })
    .from(metrics);

  const lastIngested = new Map(
    catalogRows.map((row) => [row.id, row.lastIngestedAt])
  );

  const candidates: Candidate[] = [];

  for (const row of calendarRows) {
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

  // Safety net for official metrics with no future calendar date. This keeps
  // the system live without pretending that an official release time exists.
  const nowMs = now.getTime();

  for (const metric of METRICS) {
    const config = sourceConfig(metric.id);
    if (!config) {
      continue;
    }

    if (
      isSafetyDue(
        metric,
        byMetric.get(metric.id),
        lastIngested.get(metric.id) ?? null,
        nowMs
      )
    ) {
      candidates.push({
        metricId: metric.id,
        scheduledAt: safetyScheduledAt(metric, nowMs),
        mode: "safety",
      });
    }
  }

  // Keep calendar order (release date ascending) but de-duplicate metric IDs.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.metricId)) return false;
    seen.add(candidate.metricId);
    return true;
  });
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
    source: metric?.source?.toUpperCase(),
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
    const result = await fetchMetricFromOfficialSource(candidate.metricId);
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
        retryEligibleAt: nextReleaseRetryAt(attemptStartedAt, RELEASE_RETRY_COOLDOWN_MS),
        retryDelaySeconds: RELEASE_RETRY_COOLDOWN_MS / 1000,
        elapsedMs: Date.now() - Date.parse(attemptStartedAt),
      });
      return {
        metricId: candidate.metricId,
        status: "waiting",
      };
    }

    stage = "database_update";
    const processed = await processFetchedRelease({
      metricId: candidate.metricId,
      result: {
        periodDate: result.periodDate,
        value: result.value,
        rawValue: result.rawValue,
        releasedAt: result.releasedAt,
        note: result.note,
      },
    });

    if (processed.updated) {
  /*
   * The source returned a genuinely new observation or a revision,
   * and persistRelease() successfully wrote it to the database.
   *
   * Only NOW do we mark this scheduled release as processed.
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

    if (candidate.mode === "safety" && !processed.updated && processed.reason === "no-new-release") {
      // A safety check finding identical data is complete for this time bucket.
      // Scheduled release checks remain retryable until the new value arrives.
      await markReleaseProcessed(candidate.metricId, candidate.scheduledAt);
    }

    const safetyCheckComplete = candidate.mode === "safety" &&
      !processed.updated && processed.reason === "no-new-release";
    const retryEligible = !processed.updated && !safetyCheckComplete;
    logReleaseEvent({
      event: processed.updated ? "attempt_updated" : safetyCheckComplete ? "attempt_checked_unchanged" : "attempt_retry_scheduled",
      ...context,
      status: processed.updated ? "updated" : safetyCheckComplete ? "unchanged_safety_check" : "no_new_release_yet",
      fetchedPeriod: result.periodDate,
      fetchedValue: result.value,
      previousPeriod: "latestDbPeriod" in processed ? processed.latestDbPeriod : null,
      previousValue: "latestDbValue" in processed ? processed.latestDbValue : null,
      databaseUpdated: processed.updated,
      releaseId: "releaseId" in processed ? processed.releaseId ?? null : null,
      reason: processed.reason ?? null,
      retryEligibleAt: retryEligible
        ? nextReleaseRetryAt(attemptStartedAt, RELEASE_RETRY_COOLDOWN_MS)
        : null,
      retryDelaySeconds: retryEligible ? RELEASE_RETRY_COOLDOWN_MS / 1000 : null,
      elapsedMs: Date.now() - Date.parse(attemptStartedAt),
    });

    return {
      metricId: candidate.metricId,
      status: "checked",
      processed,
      mode: candidate.mode,
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
      retryEligibleAt: nextReleaseRetryAt(attemptStartedAt, RELEASE_RETRY_COOLDOWN_MS),
      retryDelaySeconds: RELEASE_RETRY_COOLDOWN_MS / 1000,
      elapsedMs: Date.now() - Date.parse(attemptStartedAt),
    });

    return {
      metricId: candidate.metricId,
      status: "error",
      error: message,
      mode: candidate.mode,
    };
  }
}

export async function dispatchDueReleases(options?: {
  maxMetrics?: number;
  metricIds?: string[];
}) {
  const now = new Date();
  const allCandidates = await buildCandidates(now);
  const pollState = await getPollState();
  const candidates = allCandidates.filter(candidate => {
    if (options?.metricIds && !options.metricIds.includes(candidate.metricId)) return false;
    const state = pollState.get(candidate.metricId);
    if (!state) return true;
    if (state.scheduledAt === candidate.scheduledAt && state.status === "processed") return false;
    return now.getTime() - Date.parse(state.lastAttemptAt) >= RELEASE_RETRY_COOLDOWN_MS;
  }).sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "scheduled" ? -1 : 1;
    return (pollState.get(a.metricId)?.lastAttemptAt ?? "").localeCompare(pollState.get(b.metricId)?.lastAttemptAt ?? "");
  });
  const maxMetrics = Math.max(
    1,
    Number(options?.maxMetrics ?? 40)
  );

  const results: unknown[] = [];

  // We deliberately claim candidates one-by-one before fetching. This means
  // a batch of failed/slow metrics cannot permanently starve the next batch:
  // already-processing/recently-failed claims are skipped on the next cron tick.
  for (const candidate of candidates) {
    if (
      results.filter(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "status" in item &&
          (item as { status?: string }).status !== "skipped"
      ).length >= maxMetrics
    ) {
      break;
    }

    results.push(await processCandidate(candidate));
  }

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
    safetyDue: candidates.filter((x) => x.mode === "safety").length,
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
