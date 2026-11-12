import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { metrics, observations, releases } from "@/db/schema";
import { persistRelease } from "./db-writer";
import { wasRecordedAfterSchedule } from "./release-schedule-retries";
import { releaseStageFromNote, VINTAGE_TRACKED_METRICS, type ReleaseStage } from "./release-stages";
import { METRICS } from "@/catalog/metrics";
import { expectedPcePeriod, isPceMonthlySeries } from "@/lib/pce-release";

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

  const definition = METRICS.find(metric => metric.id === input.metricId);
  const expectedPeriod = input.scheduledAt && definition && isPceMonthlySeries(definition)
    ? expectedPcePeriod(input.scheduledAt) : null;
  if (expectedPeriod && input.result.periodDate < expectedPeriod) {
    return { updated: false, reason: "awaiting-pce-release-period", sourcePeriod: input.result.periodDate, expectedPeriod };
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

  const priorPeriod = await db
    .select({
      date: observations.date,
      value: observations.value,
    })
    .from(observations)
    .where(and(
      eq(observations.metricId, input.metricId),
      lt(observations.date, input.result.periodDate),
    ))
    .orderBy(desc(observations.date))
    .limit(1);
  const releasePriorPeriod = priorPeriod[0];

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
      // Untracked releases have no stage: the note parser returns null while
      // releaseStage is undefined. Normalize them so an already committed
      // scheduled release completes dispatch instead of retrying indefinitely.
      const expectedStage = releaseStage ?? null;
      const committedStageMatches = committed.some(row => releaseStageFromNote(row.notes) === expectedStage);
      const committedAfterSchedule = committed.some(row =>
        releaseStageFromNote(row.notes) === expectedStage && wasRecordedAfterSchedule(row.releasedAt, input.scheduledAt!)
      );
      if (committedAfterSchedule) {
        return {
          updated: false,
          reason: "already-recorded",
          releaseId: committed.find(row => releaseStageFromNote(row.notes) === expectedStage && wasRecordedAfterSchedule(row.releasedAt, input.scheduledAt!))?.id,
          latestDbPeriod: latest[0].date,
          latestDbValue: latest[0].value,
          sourcePeriod: input.result.periodDate,
          sourceValue: input.result.value,
        };
      }

      // A scheduled time and a same-valued response do not prove that the
      // provider has published: it may still be returning the prior vintage.
      // A tracked metric can publish the same stage more than once (for
      // example Eurostat GDP at T+30 and T+45). The dispatcher only supplies
      // its scheduled stage after the expected new reference period appears,
      // so a same-valued response is still a distinct scheduled vintage.
      const earlierSameValueRelease = committed.some(row => {
        const releasedAt = Date.parse(row.releasedAt);
        const scheduledAt = Date.parse(input.scheduledAt!);
        return Number.isFinite(releasedAt) && Number.isFinite(scheduledAt) && releasedAt < scheduledAt;
      });
      if (earlierSameValueRelease && input.result.releaseStage &&
          (!committedStageMatches || (VINTAGE_TRACKED_METRICS.has(input.metricId) && Boolean(input.scheduledAt)))) {
        return persistRelease({
          metricId: input.metricId,
          periodDate: input.result.periodDate,
          value: input.result.value,
          rawValue: input.result.rawValue ?? null,
          releasedAt: input.result.releasedAt ?? new Date().toISOString(),
          priorPeriodValue: releasePriorPeriod?.value ?? null,
          priorPeriodDate: releasePriorPeriod?.date ?? null,
          supportingDocUrl: metric[0].docsUrl,
          releaseStage,
          forceNewRelease: true,
          notes: input.result.note ?? `Official scheduled release confirmed unchanged for ${input.result.periodDate}`,
        });
      }

      // An explicit new source stage can confirm an unchanged publication.
      if (!committedStageMatches && VINTAGE_TRACKED_METRICS.has(input.metricId) && input.result.releaseStage) {
        const confirmed = await persistRelease({
          metricId: input.metricId,
          periodDate: input.result.periodDate,
          value: input.result.value,
          rawValue: input.result.rawValue ?? null,
          releasedAt: input.result.releasedAt ?? new Date().toISOString(),
          priorPeriodValue: releasePriorPeriod?.value ?? null,
          priorPeriodDate: releasePriorPeriod?.date ?? null,
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
    priorPeriodValue: releasePriorPeriod?.value ?? null,
    priorPeriodDate: releasePriorPeriod?.date ?? null,
    supportingDocUrl: metric[0].docsUrl,
    releaseStage,
    notes:
      input.result.note ??
      `Official release detected for ${input.metricId}`,
  });
}
