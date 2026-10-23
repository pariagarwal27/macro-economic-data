import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { metrics, observations, releases } from "@/db/schema";
import { persistRelease } from "./db-writer";
import { UK_RETAIL_RELEASE_IDS, isUkRetailReleasePeriod } from "@/lib/uk-retail";
import { wasRecordedAfterSchedule } from "./release-schedule-retries";
import { releaseStageFromNote, VINTAGE_TRACKED_METRICS, type ReleaseStage } from "./release-stages";

function isScheduledEurostatHicpPeriod(metricId: string, scheduledAt: string, periodDate: string) {
  const eurostatHicpMetric = (metricId.startsWith("ea-") && metricId.includes("hicp")) ||
    /^(de|fr|it|es)-cpi-yoy$/.test(metricId);
  if (!eurostatHicpMetric) return false;
  const scheduledDate = scheduledAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!scheduledDate) return false;
  const [, yearText, monthText] = scheduledDate.match(/^(\d{4})-(\d{2})-/) ?? [];
  if (!yearText || !monthText) return false;
  const expectedPeriod = new Date(Date.UTC(Number(yearText), Number(monthText) - 2, 1))
    .toISOString()
    .slice(0, 7);
  return periodDate.slice(0, 7) === expectedPeriod;
}

export async function processFetchedRelease(input: {
  metricId: string;
  scheduledAt?: string;
  result: {
    periodDate: string;
    value: number;
    rawValue?: string | number | null;
    releasedAt?: string;
    releaseStage?: ReleaseStage;
    note?: string | null;
  };
}) {
  if (!input.result.periodDate) {
    throw new Error(`Missing periodDate for ${input.metricId}`);
  }

  if (!Number.isFinite(input.result.value)) {
    throw new Error(`Invalid release value for ${input.metricId}`);
  }

  const db = getDb();

  const metric = await db
    .select({
      id: metrics.id,
      docsUrl: metrics.docsUrl,
    })
    .from(metrics)
    .where(eq(metrics.id, input.metricId))
    .limit(1);

  if (!metric[0]) {
    throw new Error(`Unknown metric ${input.metricId}`);
  }

  /*
   * Get the latest observation currently stored for this metric.
   *
   * IMPORTANT:
   *
   * If the official source returns the exact same period + value
   * that we already have, that does NOT mean the scheduled release
   * has been successfully detected.
   *
   * It may simply mean the official provider has not published the
   * new observation yet.
   */
  const latest = await db
    .select({
      date: observations.date,
      value: observations.value,
    })
    .from(observations)
    .where(eq(observations.metricId, input.metricId))
    .orderBy(desc(observations.date))
    .limit(1);

  const priorVintageRows = await db
    .select({ value: releases.value, notes: releases.notes, releasedAt: releases.releasedAt })
    .from(releases)
    .where(and(eq(releases.metricId, input.metricId), eq(releases.periodDate, input.result.periodDate)))
    .orderBy(desc(releases.releasedAt))
    .limit(8);
  const priorTaggedVintage = priorVintageRows.find(row => releaseStageFromNote(row.notes));
  const previousStage = releaseStageFromNote(priorTaggedVintage?.notes);
  const valueChanged = priorTaggedVintage != null && Number(priorTaggedVintage.value) !== Number(input.result.value);
  const inferredStage: ReleaseStage | undefined = input.result.releaseStage ?? (
    previousStage === "flash" || previousStage === "estimate"
      ? "final"
      : valueChanged ? "revised" : "final"
  );
  const releaseStage = VINTAGE_TRACKED_METRICS.has(input.metricId) ? inferredStage : undefined;

  /*
   * CASE 1:
   *
   * Source returned an older observation than our DB.
   *
   * Example:
   *
   * DB     = 2026-09-01
   * Source = 2026-08-01
   *
   * Never move backwards.
   *
   * This is NOT a successful release.
   * The dispatcher must retry later.
   */
  if (latest[0] && input.result.periodDate < latest[0].date) {
    return {
      updated: false,
      reason: "source-period-older-than-db",
      latestDbPeriod: latest[0].date,
      sourcePeriod: input.result.periodDate,
    };
  }

  /*
   * CASE 2:
   *
   * Source returned exactly the observation we already have.
   *
   * Example:
   *
   * DB:
   *   period = 2026-09-01
   *   value  = 3.0
   *
   * Source:
   *   period = 2026-09-01
   *   value  = 3.0
   *
   * This is the CRITICAL release-day case.
   *
   * The provider may simply not have published the new period yet.
   *
   * Therefore:
   *
   *   DO NOT mark the dispatch as processed.
   *   DO NOT mark the metric as released.
   *   Tell the dispatcher to retry.
   */
  if (
    latest[0] &&
    input.result.periodDate === latest[0].date &&
    Number(input.result.value) === Number(latest[0].value)
  ) {
    if (input.scheduledAt && Number.isFinite(Date.parse(input.scheduledAt))) {
      const committed = await db
        .select({ id: releases.id, releasedAt: releases.releasedAt, notes: releases.notes })
        .from(releases)
        .where(and(
          eq(releases.metricId, input.metricId),
          eq(releases.periodDate, input.result.periodDate),
          eq(releases.value, input.result.value),
        ))
        .orderBy(desc(releases.releasedAt))
        .limit(8);
      const committedStageMatches = committed.some(row => releaseStageFromNote(row.notes) === releaseStage);
      const committedAfterSchedule = committed.some(row =>
        releaseStageFromNote(row.notes) === releaseStage && wasRecordedAfterSchedule(row.releasedAt, input.scheduledAt!)
      );
      if (committedAfterSchedule) {
        return {
          updated: false,
          reason: "already-recorded",
          releaseId: committed.find(row => releaseStageFromNote(row.notes) === releaseStage)?.id,
          latestDbPeriod: latest[0].date,
          latestDbValue: latest[0].value,
          sourcePeriod: input.result.periodDate,
          sourceValue: input.result.value,
        };
      }

      // An official HICP schedule confirms a release even when the published
      // number matches an earlier value (for example, final matching flash).
      if (!committedStageMatches && (
        (VINTAGE_TRACKED_METRICS.has(input.metricId) && Boolean(releaseStage)) ||
        isScheduledEurostatHicpPeriod(input.metricId, input.scheduledAt, input.result.periodDate) ||
        (UK_RETAIL_RELEASE_IDS.includes(input.metricId) && isUkRetailReleasePeriod(input.scheduledAt, input.result.periodDate))
      )) {
        const confirmed = await persistRelease({
          metricId: input.metricId,
          periodDate: input.result.periodDate,
          value: input.result.value,
          rawValue: input.result.rawValue ?? null,
          releasedAt: input.result.releasedAt ?? new Date().toISOString(),
          supportingDocUrl: metric[0].docsUrl,
          releaseStage,
          notes: input.result.note ?? `Official scheduled Eurostat HICP release confirmed unchanged for ${input.result.periodDate}`,
        });
        return confirmed.updated ? confirmed : {
          ...confirmed,
          reason: "confirmed-unchanged",
          latestDbPeriod: latest[0].date,
          latestDbValue: latest[0].value,
          sourcePeriod: input.result.periodDate,
          sourceValue: input.result.value,
        };
      }
    }
    return {
      updated: false,
      reason: "no-new-release",
      latestDbPeriod: latest[0].date,
      latestDbValue: latest[0].value,
      sourcePeriod: input.result.periodDate,
      sourceValue: input.result.value,
    };
  }

  /*
   * CASE 3:
   *
   * Same observation period but different value.
   *
   * This is a legitimate revision.
   *
   * Example:
   *
   * DB:
   *   2026-09-01 = 3.0
   *
   * Source:
   *   2026-09-01 = 3.1
   *
   * persistRelease() will create a revision and mark the new
   * observation as latest.
   */
  return persistRelease({
    metricId: input.metricId,
    periodDate: input.result.periodDate,
    value: input.result.value,
    rawValue: input.result.rawValue ?? null,
    releasedAt:
      input.result.releasedAt ?? new Date().toISOString(),
    supportingDocUrl: metric[0].docsUrl,
    releaseStage,
    notes:
      input.result.note ??
      `Official release detected for ${input.metricId}`,
  });
}
