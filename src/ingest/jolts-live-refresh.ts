import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  metrics,
  observations,
  releases,
} from "@/db/schema";

const JOLTS_METRIC_ID = "us-jolts-openings";
const BLS_SERIES_ID = "JTS000000000000000JOL";

const BLS_URL =
  `https://api.bls.gov/publicAPI/v2/timeseries/data/${BLS_SERIES_ID}?latest=true`;

type BLSObservation = {
  year: string;
  period: string;
  periodName: string;
  value: string;
  latest?: string;
};

type BLSResponse = {
  status: string;
  message?: string[];
  Results?: {
    series?: Array<{
      seriesID: string;
      data: BLSObservation[];
    }>;
  };
};

export async function refreshJoltsIfNew(): Promise<{
  updated: boolean;
  metricId: string;
  observationDate?: string;
  value?: number;
  message: string;
}> {
  /*
   * IMPORTANT:
   * This live path uses ONLY the official BLS API.
   * There is NO FRED fallback.
   */

  const response = await fetch(BLS_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `BLS API returned HTTP ${response.status}`
    );
  }

  const data =
    (await response.json()) as BLSResponse;

  if (data.status !== "REQUEST_SUCCEEDED") {
    throw new Error(
      `BLS API failed: ${
        data.message?.join("; ") || "unknown error"
      }`
    );
  }

  const series = data.Results?.series?.[0];

  if (!series || !series.data?.length) {
    throw new Error(
      "BLS returned no JOLTS observations."
    );
  }

  const latest = series.data[0];

  const value = Number(latest.value);

  if (!Number.isFinite(value)) {
    throw new Error(
      `Invalid JOLTS value: ${latest.value}`
    );
  }

  /*
   * JOLTS is monthly.
   *
   * Example:
   *   year   = 2026
   *   period = M08
   *
   * Stored as:
   *   2026-08-01
   */
  if (!/^M(0[1-9]|1[0-2])$/.test(latest.period)) {
    throw new Error(
      `Unexpected JOLTS period: ${latest.period}`
    );
  }

  const month = latest.period.substring(1);

  const observationDate =
    `${latest.year}-${month}-01`;

  const releasedAt =
    new Date().toISOString();

  const db = getDb();

  /*
   * Find the observation for the exact BLS period.
   */
  const exactRows = await db
    .select({
      id: observations.id,
      value: observations.value,
      releasedAt: observations.releasedAt,
      date: observations.date,
    })
    .from(observations)
    .where(
      eq(
        observations.metricId,
        JOLTS_METRIC_ID
      )
    );

  const previous = exactRows.find(
    (row) =>
      row.date === observationDate
  );

  /*
   * ---------------------------------------------------------
   * CASE 1
   * ---------------------------------------------------------
   * Observation does NOT exist.
   *
   * This is a genuinely new observation period.
   */
  if (!previous) {
    /*
     * Previous JOLTS observations are no longer latest.
     */
    await db
      .update(observations)
      .set({
        isLatest: false,
      })
      .where(
        eq(
          observations.metricId,
          JOLTS_METRIC_ID
        )
      );

    /*
     * Insert the new observation.
     */
    await db
      .insert(observations)
      .values({
        metricId: JOLTS_METRIC_ID,
        date: observationDate,
        value,
        rawValue: value,
        releasedAt,
        vintageDate: releasedAt.slice(0, 10),
        isLatest: true,
      });

    /*
     * Record the release.
     */
    await db
      .insert(releases)
      .values({
        metricId: JOLTS_METRIC_ID,
        periodDate: observationDate,
        releasedAt,
        value,
        supportingDocUrl:
          "https://www.bls.gov/news.release/jolts.htm",
        notes:
          "Automatically fetched from official BLS JOLTS API.",
      });

    /*
     * Update metric metadata.
     */
    await db
      .update(metrics)
      .set({
        lastIngestedAt: releasedAt,
        observationCount:
          exactRows.length + 1,
      })
      .where(
        eq(
          metrics.id,
          JOLTS_METRIC_ID
        )
      );

    return {
      updated: true,
      metricId: JOLTS_METRIC_ID,
      observationDate,
      value,
      message:
        "New JOLTS observation released and updated from BLS.",
    };
  }

  /*
   * ---------------------------------------------------------
   * CASE 2
   * ---------------------------------------------------------
   * The observation already exists.
   *
   * First check whether THIS PERIOD has already been recorded
   * as a release.
   *
   * This is the important fix for:
   *
   * DB  = 7079
   * BLS = 7079
   *
   * but the BLS release itself is new.
   */
  const existingRelease = await db
    .select({
      periodDate: releases.periodDate,
      releasedAt: releases.releasedAt,
      value: releases.value,
    })
    .from(releases)
    .where(
      and(
        eq(
          releases.metricId,
          JOLTS_METRIC_ID
        ),
        eq(
          releases.periodDate,
          observationDate
        )
      )
    )
    .limit(1);

  /*
   * ---------------------------------------------------------
   * CASE 2A
   * ---------------------------------------------------------
   * Observation exists, but this period has NOT yet been
   * recorded as a release.
   *
   * This is today's situation:
   *
   *   DB  = Aug 2026 / 7079
   *   BLS = Aug 2026 / 7079
   *   release record = not yet recorded
   *
   * Therefore we must process the release even though the
   * numeric value did not change.
   */
  if (!existingRelease.length) {
    /*
     * Make sure this observation is the latest JOLTS
     * observation.
     */
    await db
      .update(observations)
      .set({
        isLatest: false,
      })
      .where(
        eq(
          observations.metricId,
          JOLTS_METRIC_ID
        )
      );

    await db
      .update(observations)
      .set({
        releasedAt,
        vintageDate:
          releasedAt.slice(0, 10),
        isLatest: true,
      })
      .where(
        eq(
          observations.id,
          previous.id
        )
      );

    /*
     * Record the new official BLS release.
     */
    await db
      .insert(releases)
      .values({
        metricId: JOLTS_METRIC_ID,
        periodDate: observationDate,
        releasedAt,
        value,
        supportingDocUrl:
          "https://www.bls.gov/news.release/jolts.htm",
        notes:
          "New JOLTS release detected from official BLS API. Value unchanged from pre-existing observation.",
      });

    /*
     * Update metric ingestion timestamp.
     */
    await db
      .update(metrics)
      .set({
        lastIngestedAt: releasedAt,
      })
      .where(
        eq(
          metrics.id,
          JOLTS_METRIC_ID
        )
      );

    return {
      updated: true,
      metricId: JOLTS_METRIC_ID,
      observationDate,
      value,
      message:
        "New JOLTS release detected from BLS; value unchanged.",
    };
  }

  /*
   * ---------------------------------------------------------
   * CASE 2B
   * ---------------------------------------------------------
   * The release already exists AND the value is unchanged.
   *
   * This is a normal subsequent cron check.
   */
  if (
    Number(previous.value) === value
  ) {
    return {
      updated: false,
      metricId: JOLTS_METRIC_ID,
      observationDate,
      value,
      message:
        "JOLTS source checked; release already processed.",
    };
  }

  /*
   * ---------------------------------------------------------
   * CASE 2C
   * ---------------------------------------------------------
   * The observation exists and the value has changed.
   *
   * This means BLS revised the observation.
   */

  /*
   * First mark all JOLTS observations as not latest.
   */
  await db
    .update(observations)
    .set({
      isLatest: false,
    })
    .where(
      eq(
        observations.metricId,
        JOLTS_METRIC_ID
      )
    );

  /*
   * Then update the revised observation and make it latest.
   */
  await db
    .update(observations)
    .set({
      value,
      rawValue: value,
      releasedAt,
      vintageDate:
        releasedAt.slice(0, 10),
      isLatest: true,
    })
    .where(
      eq(
        observations.id,
        previous.id
      )
    );

  /*
   * Record the revision as a release event.
   */
  await db
    .insert(releases)
    .values({
      metricId: JOLTS_METRIC_ID,
      periodDate: observationDate,
      releasedAt,
      value,
      supportingDocUrl:
        "https://www.bls.gov/news.release/jolts.htm",
      notes:
        "JOLTS observation revised from official BLS API.",
    });

  /*
   * Update metric metadata.
   */
  await db
    .update(metrics)
    .set({
      lastIngestedAt: releasedAt,
    })
    .where(
      eq(
        metrics.id,
        JOLTS_METRIC_ID
      )
    );

  return {
    updated: true,
    metricId: JOLTS_METRIC_ID,
    observationDate,
    value,
    message:
      "JOLTS revised observation updated from BLS.",
  };
}