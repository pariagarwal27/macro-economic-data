import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { metrics, observations, releases } from "@/db/schema";
import { persistRelease } from "./db-writer";
import { wasRecordedAfterSchedule } from "./release-schedule-retries";

export async function processFetchedRelease(input: {
  metricId: string;
  scheduledAt?: string;
  result: {
    periodDate: string;
    value: number;
    rawValue?: string | number | null;
    releasedAt?: string;
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
        .select({ id: releases.id, releasedAt: releases.releasedAt })
        .from(releases)
        .where(and(
          eq(releases.metricId, input.metricId),
          eq(releases.periodDate, input.result.periodDate),
          eq(releases.value, input.result.value),
        ))
        .orderBy(desc(releases.releasedAt))
        .limit(1);
      const committedAfterSchedule = committed[0] && wasRecordedAfterSchedule(committed[0].releasedAt, input.scheduledAt);
      if (committedAfterSchedule) {
        return {
          updated: false,
          reason: "already-recorded",
          releaseId: committed[0].id,
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
    notes:
      input.result.note ??
      `Official release detected for ${input.metricId}`,
  });
}
