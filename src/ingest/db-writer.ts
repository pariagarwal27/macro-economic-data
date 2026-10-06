import { and, desc, eq } from "drizzle-orm";
import { getDb, getD1Database } from "@/db";
import { metrics, observations, releases } from "@/db/schema";

export type PersistReleaseInput = {
  metricId: string;
  periodDate: string;
  value: number;
  rawValue?: string | number | null;
  releasedAt: string;
  vintageDate?: string | null;
  expectedValue?: number | null;
  priorPeriodValue?: number | null;
  priorPeriodDate?: string | null;
  priorReleaseValue?: number | null;
  changeVsPriorPeriod?: number | null;
  changeVsPriorRelease?: number | null;
  supportingDocUrl?: string | null;
  notes?: string | null;
};

export async function persistRelease(input: PersistReleaseInput) {
  const db = getDb();

  /*
   * 1. Make sure the metric exists.
   */
  const metric = await db
    .select({
      id: metrics.id,
    })
    .from(metrics)
    .where(eq(metrics.id, input.metricId))
    .limit(1);

  if (metric.length === 0) {
    throw new Error(
      `Cannot persist release: metric "${input.metricId}" does not exist`
    );
  }

  /*
   * 2. Find the latest release already recorded for this
   *    metric + observation period.
   *
   *    This gives us idempotency:
   *
   *    same period + same value
   *         -> do nothing
   *
   *    same period + changed value
   *         -> record a revision
   */
  const existingReleases = await db
    .select()
    .from(releases)
    .where(
      and(
        eq(releases.metricId, input.metricId),
        eq(releases.periodDate, input.periodDate)
      )
    )
    .orderBy(desc(releases.id))
    .limit(1);

  const existingRelease = existingReleases[0];

  if (
    existingRelease &&
    Number(existingRelease.value) === Number(input.value)
  ) {
    return {
      updated: false,
      reason: "already-recorded",
      releaseId: existingRelease.id,
      observationId: null,
    };
  }

  /*
   * 3. Convert rawValue to the DB's actual numeric type.
   *
   *    The source adapters may return "7079" as a string,
   *    but observations.raw_value is REAL in your schema.
   */
  let rawValue: number | null = null;

  if (input.rawValue !== null && input.rawValue !== undefined) {
    const parsed = Number(input.rawValue);

    if (Number.isFinite(parsed)) {
      rawValue = parsed;
    }
  }

  const database = getD1Database();
  if (database) {
    // D1 batch is atomic: observations and release history succeed together.
    const results = await database.batch([
      database.prepare("UPDATE observations SET is_latest = 0 WHERE metric_id = ? AND date = ?").bind(input.metricId, input.periodDate),
      database.prepare(`INSERT INTO observations(metric_id,date,value,raw_value,released_at,vintage_date,is_latest)
        VALUES(?,?,?,?,?,?,1) RETURNING id`).bind(
        input.metricId, input.periodDate, input.value, rawValue, input.releasedAt, input.vintageDate ?? input.releasedAt,
      ),
      database.prepare(`INSERT INTO releases(metric_id,period_date,released_at,value,expected_value,prior_period_value,
        prior_period_date,prior_release_value,change_vs_prior_period,change_vs_prior_release,supporting_doc_url,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(
        input.metricId, input.periodDate, input.releasedAt, input.value, input.expectedValue ?? null,
        input.priorPeriodValue ?? null, input.priorPeriodDate ?? null, input.priorReleaseValue ?? null,
        input.changeVsPriorPeriod ?? null, input.changeVsPriorRelease ?? null, input.supportingDocUrl ?? null, input.notes ?? null,
      ),
      database.prepare("UPDATE metrics SET last_ingested_at = ? WHERE id = ?").bind(input.releasedAt, input.metricId),
    ]);
    return {
      updated: true, reason: existingRelease ? "revision-recorded" : "new-release",
      observationId: Number((results[1].results[0] as { id: number } | undefined)?.id ?? 0) || null,
      releaseId: Number((results[2].results[0] as { id: number } | undefined)?.id ?? 0) || null,
    };
  }

  /*
   * 4. Mark previous observations for this metric/period
   *    as no longer latest.
   */
  await db
    .update(observations)
    .set({
      isLatest: false,
    })
    .where(
      and(
        eq(observations.metricId, input.metricId),
        eq(observations.date, input.periodDate)
      )
    );

  /*
   * 5. Insert the new observation.
   */
  const insertedObservation = await db
    .insert(observations)
    .values({
      metricId: input.metricId,
      date: input.periodDate,
      value: input.value,
      rawValue,
      releasedAt: input.releasedAt,
      vintageDate: input.vintageDate ?? null,
      isLatest: true,
    })
    .returning({
      id: observations.id,
    });

  /*
   * 6. Insert the release record.
   *
   *    If the source later revises the same period/value,
   *    this creates a new release row rather than destroying
   *    the original release history.
   */
  const insertedRelease = await db
    .insert(releases)
    .values({
      metricId: input.metricId,
      periodDate: input.periodDate,
      releasedAt: input.releasedAt,
      value: input.value,

      expectedValue: input.expectedValue ?? null,

      priorPeriodValue: input.priorPeriodValue ?? null,
      priorPeriodDate: input.priorPeriodDate ?? null,

      priorReleaseValue: input.priorReleaseValue ?? null,

      changeVsPriorPeriod: input.changeVsPriorPeriod ?? null,
      changeVsPriorRelease: input.changeVsPriorRelease ?? null,

      supportingDocUrl: input.supportingDocUrl ?? null,
      notes: input.notes ?? null,
    })
    .returning({
      id: releases.id,
    });

  /*
   * 7. Update metric ingestion metadata.
   */
  await db
    .update(metrics)
    .set({
      lastIngestedAt: input.releasedAt,
    })
    .where(eq(metrics.id, input.metricId));

  return {
    updated: true,
    reason: existingRelease ? "revision-recorded" : "new-release",
    observationId: insertedObservation[0]?.id ?? null,
    releaseId: insertedRelease[0]?.id ?? null,
  };
}
