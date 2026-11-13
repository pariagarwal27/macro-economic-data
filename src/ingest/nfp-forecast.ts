import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { executeSql, getDb } from "@/db";
import { calendarEvents, nfpForecastRuns, observations, releases } from "@/db/schema";
import { mergeNfpStoredHistory } from "@/lib/nfp-stored-history";
import { getEconomicCalendarRows } from "@/lib/economic-calendar-db";
import {
  forecastNfpForRelease,
  isNfpForecastWindow,
  nfpTargetMonthFromRelease,
  type NfpForecastSnapshot,
  type NfpModelRelease,
  type NfpCalendarEvent,
} from "@/lib/nfp-live-model";

const NFP_SOURCE_METRIC_IDS = [
  "us-nfp",
  "us-adp-change",
  "us-initial-claims",
  "us-continuing-claims",
  "us-jolts-openings",
  "us-jolts-hires",
  "us-jolts-hires-level",
  "us-jolts-quits",
  "us-jolts-quits-level",
  "us-jolts-layoffs",
  "us-jolts-layoffs-level",
  "us-jolts-total-separations-rate",
  "us-jolts-total-separations",
  "us-payrolls-level",
  "us-temp-help",
  "us-private-payrolls",
  "us-avg-workweek",
  "us-ism-manufacturing-pmi",
  "us-ism-services-pmi",
  "us-ism-manufacturing-employment",
  "us-ism-services-employment",
] as const;

const NFP_CONSENSUS_METRIC_IDS = ["us-nfp", "us-adp-change"] as const;
const LIVE_MODEL_ID = "revised_no_indeed_pruned";

export type StoredNfpForecast = Omit<NfpForecastSnapshot, "inputs" | "sourceReleaseCount"> & {
  inputHash: string;
  /** True throughout the New York calendar day before the scheduled release. */
  isFinalDay: boolean;
};

export type NfpForecastWindow = { releaseAt: string; startsAt: string; targetMonth: string };

let nfpSchemaReady: Promise<void> | null = null;

/** Create the forecast snapshot table in the local database. */
export async function ensureNfpForecastSchema() {
  if (!nfpSchemaReady) {
    nfpSchemaReady = (async () => {
      await executeSql(`CREATE TABLE IF NOT EXISTS nfp_forecast_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_month TEXT NOT NULL,
        release_at TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL,
        model_status TEXT NOT NULL,
        consensus_value REAL,
        predicted_surprise REAL NOT NULL,
        forecast_value REAL,
        feature_count INTEGER NOT NULL,
        feature_total INTEGER NOT NULL,
        input_hash TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      await executeSql("CREATE UNIQUE INDEX IF NOT EXISTS nfp_forecast_input_uniq ON nfp_forecast_runs(target_month, model_id, input_hash)");
      await executeSql("CREATE INDEX IF NOT EXISTS nfp_forecast_latest_idx ON nfp_forecast_runs(target_month, created_at)");
    })().catch(error => {
      nfpSchemaReady = null;
      throw error;
    });
  }
  await nfpSchemaReady;
}

function scheduleReleaseAt(row: { nextReleaseAt: string | null; nextReleaseDate: string | null }) {
  if (row.nextReleaseAt && Number.isFinite(Date.parse(row.nextReleaseAt))) return new Date(row.nextReleaseAt).toISOString();
  if (!row.nextReleaseDate) return null;
  const date = row.nextReleaseDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T23:59:59.999Z` : null;
}

export async function getNextNfpForecastWindow(now = new Date()): Promise<NfpForecastWindow | null> {
  const schedule = (await getEconomicCalendarRows())
    .find(row => row.metricId === "us-nfp" && row.nextReleaseDate);
  if (!schedule) return null;
  const releaseAt = scheduleReleaseAt(schedule);
  const targetMonth = releaseAt ? nfpTargetMonthFromRelease(releaseAt) : null;
  if (!releaseAt || !targetMonth || Date.parse(releaseAt) < now.getTime()) return null;
  return {
    releaseAt,
    startsAt: new Date(Date.parse(releaseAt) - 7 * 86_400_000).toISOString(),
    targetMonth,
  };
}

function stableInputHash(snapshot: NfpForecastSnapshot, releaseRows: NfpModelRelease[], events: NfpCalendarEvent[]) {
  const canonical = JSON.stringify({
    targetMonth: snapshot.targetMonth,
    releaseAt: snapshot.releaseAt,
    model: snapshot.model,
    status: snapshot.status,
    consensus: snapshot.consensus,
    predictedSurprise: snapshot.predictedSurprise,
    forecast: snapshot.forecast,
    inputs: snapshot.inputs,
    releaseRows,
    events,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The scheduled release worker calls this every minute. It records a new
 * revision only when the dated release, consensus, or model inputs change.
 */
export async function refreshNfpForecast(now = new Date()) {
  await ensureNfpForecastSchema();
  const schedule = (await getEconomicCalendarRows())
    .find(row => row.metricId === "us-nfp" && row.nextReleaseDate);
  if (!schedule) return { active: false, reason: "No scheduled NFP release found." };

  const releaseAt = scheduleReleaseAt(schedule);
  if (!releaseAt || !isNfpForecastWindow(releaseAt, now)) {
    return { active: false, reason: "Outside the one-week NFP forecast window.", releaseAt };
  }
  const targetMonth = nfpTargetMonthFromRelease(releaseAt);
  if (!targetMonth) return { active: false, reason: "Could not determine the payroll target month.", releaseAt };

  const db = getDb();
  const storedReleases = await db
    .select({
      metricId: releases.metricId,
      periodDate: releases.periodDate,
      releasedAt: releases.releasedAt,
      value: releases.value,
      expectedValue: releases.expectedValue,
    })
    .from(releases)
    .where(and(
      inArray(releases.metricId, [...NFP_SOURCE_METRIC_IDS]),
      lte(releases.releasedAt, now.toISOString()),
      lte(releases.releasedAt, releaseAt),
    ))
    .orderBy(asc(releases.releasedAt)) as NfpModelRelease[];

  // Backfills populate observations for the full history but usually create
  // only one release row. Preserve release records when both are present.
  const storedObservations = await db.select({
    metricId: observations.metricId,
    periodDate: observations.date,
    releasedAt: observations.releasedAt,
    value: observations.value,
  }).from(observations).where(and(
    inArray(observations.metricId, [...NFP_SOURCE_METRIC_IDS]),
    eq(observations.isLatest, true),
    lte(observations.releasedAt, now.toISOString()),
    lte(observations.releasedAt, releaseAt),
  )).orderBy(desc(observations.releasedAt));
  const releaseRows = mergeNfpStoredHistory(storedReleases,
    storedObservations.filter((row): row is typeof row & { releasedAt: string } => row.releasedAt != null), now.toISOString());

  const events = await db
    .select({
      metricId: calendarEvents.metricId,
      source: calendarEvents.source,
      releasedAt: calendarEvents.releasedAt,
      forecast: calendarEvents.forecast,
      importedAt: calendarEvents.importedAt,
    })
    .from(calendarEvents)
    .where(and(
      inArray(calendarEvents.metricId, [...NFP_CONSENSUS_METRIC_IDS]),
      eq(calendarEvents.source, "investing"),
      lte(calendarEvents.releasedAt, releaseAt),
    ))
    .orderBy(asc(calendarEvents.releasedAt)) as NfpCalendarEvent[];

  const snapshot = forecastNfpForRelease({
    targetMonth,
    releaseAt,
    asOf: now.toISOString(),
    releases: releaseRows,
    calendarEvents: events,
  });
  const eligibleEvents = events.filter(event => !event.importedAt || Date.parse(event.importedAt) <= now.getTime());
  const inputHash = stableInputHash(snapshot, releaseRows, eligibleEvents);
  const prior = await db
    .select({ id: nfpForecastRuns.id })
    .from(nfpForecastRuns)
    .where(and(
      eq(nfpForecastRuns.targetMonth, targetMonth),
      eq(nfpForecastRuns.modelId, LIVE_MODEL_ID),
      eq(nfpForecastRuns.inputHash, inputHash),
    ))
    .limit(1);

  if (prior.length) return { active: true, inserted: false, snapshot };

  try {
    await db.insert(nfpForecastRuns).values({
      targetMonth,
      releaseAt,
      modelId: LIVE_MODEL_ID,
      status: snapshot.status,
      modelStatus: snapshot.modelStatus,
      consensusValue: snapshot.consensus,
      predictedSurprise: snapshot.predictedSurprise,
      forecastValue: snapshot.forecast,
      featureCount: snapshot.featureCount,
      featureTotal: snapshot.featureTotal,
      inputHash,
      inputsJson: JSON.stringify({
        features: snapshot.inputs,
        sourceReleaseCount: snapshot.sourceReleaseCount,
        sourceMetricIds: NFP_SOURCE_METRIC_IDS,
        releases: releaseRows,
        calendarEvents: eligibleEvents,
        provenance: "conditional: missing release periods use stored observations with their ingestion timestamps; historical observations may be revised and source publication times and original vintages are not independently verified; release ingestion time is not stored",
      }),
      createdAt: snapshot.asOf,
    });
  } catch (error) {
    // A concurrent minute tick may win the same unique snapshot insert.
    const retry = await db
      .select({ id: nfpForecastRuns.id })
      .from(nfpForecastRuns)
      .where(and(
        eq(nfpForecastRuns.targetMonth, targetMonth),
        eq(nfpForecastRuns.modelId, LIVE_MODEL_ID),
        eq(nfpForecastRuns.inputHash, inputHash),
      ))
      .limit(1);
    if (!retry.length) throw error;
    return { active: true, inserted: false, snapshot };
  }

  return { active: true, inserted: true, snapshot };
}

export async function getLatestNfpForecast(targetMonth?: string): Promise<StoredNfpForecast | null> {
  await ensureNfpForecastSchema();
  const db = getDb();
  const query = db
    .select({
      targetMonth: nfpForecastRuns.targetMonth,
      releaseAt: nfpForecastRuns.releaseAt,
      model: nfpForecastRuns.modelId,
      status: nfpForecastRuns.status,
      modelStatus: nfpForecastRuns.modelStatus,
      consensus: nfpForecastRuns.consensusValue,
      predictedSurprise: nfpForecastRuns.predictedSurprise,
      forecast: nfpForecastRuns.forecastValue,
      featureCount: nfpForecastRuns.featureCount,
      featureTotal: nfpForecastRuns.featureTotal,
      inputHash: nfpForecastRuns.inputHash,
      asOf: nfpForecastRuns.createdAt,
    })
    .from(nfpForecastRuns);
  const [row] = await (targetMonth ? query.where(eq(nfpForecastRuns.targetMonth, targetMonth)) : query)
    .orderBy(desc(nfpForecastRuns.createdAt), desc(nfpForecastRuns.id))
    .limit(1);
  if (!row) return null;
  const nyDate = (value: string | Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
  const releaseDate = nyDate(row.releaseAt);
  const previousDay = new Date(`${releaseDate}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const isFinalDay = nyDate(new Date()) === previousDay.toISOString().slice(0, 10);
  return { ...row, status: row.status as NfpForecastSnapshot["status"], isFinalDay };
}
