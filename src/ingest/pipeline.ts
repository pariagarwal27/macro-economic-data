
import { METRICS, X_HANDLES, type MetricDef } from "@/catalog/metrics";
import {
  DESK_MATRIX_BLOCKS,
  allDeskMatrixMetricIds,
  cellAllowed,
  type ColumnRule,
  type DeskRegion,
  toQuarterEndPeriod,
} from "@/catalog/desk-matrix";
import {
  fetchCensusRetailSeries,
} from "./census-retail";

import {
  fetchPmiMetric,
  type PmiMetricKey,
} from "./pmi-scraper";
import {
  DESK_SMOOTHED_ROWS,
  SMOOTH_METHOD_LABELS,
  SMOOTH_METHOD_SHORT,
  allDeskSmoothedMetricIds,
  type SmoothMethod,
} from "@/catalog/desk-smoothed";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
} from "drizzle-orm";
import { LIVE_MAP } from "@/catalog/live-map";
import { fetchLsegLatest } from "./adapters/lseg";
import { investingToCatalogScale } from "@/catalog/investing-map";
import { getClient, getDb, getD1Database } from "@/db";
import {
  calendarEvents,
  ingestRuns,
  metrics,
  observations,
  releases,
  sourceHandles,
} from "@/db/schema";
import { computeSurprise } from "@/lib/surprise";
import {
  annualized3mFromIndex,
  annualized3mFromMom,
  indexLevel,
  movingAverage3,
  roundSmooth,
  windowEndingAt,
  type SeriesPoint,
} from "@/lib/smoothing";
import {
  calendarCountryToRegion,
  classifyCalendarEvent,
  dedupeCalendarRows,
  speakerInstitution,
  utcDayStart,
  addUtcDays,
} from "@/lib/calendar-tape";
import { fetchFredSeries, mapPool } from "./fred";
import { fetchEurostatPreset } from "./eurostat";
import { fetchOnsSeries } from "./ons";
import {
  fetchEcbSpfHicp1y,
  fetchEcbSpfSeries,
  fetchEcbCesInflation1y,
  fetchEcbCesInflation3y,
  fetchEcbCesInflation5y,
  type EcbSpfSeries,
} from "./ecb-spf";
import {
  fetchEcbSafeWageExpectations,
  fetchEcbSafeSellingPriceExpectations,
  fetchEcbSafeInputCostExpectations,
} from "./ecb-safe";
import { fetchBoeInflationExpectations1y, fetchBoeInflationExpectations } from "./boe-inflation-attitudes";
import {
  fetchBoeDmpWages,
  fetchBoeDmpSeries,
  fetchBoeMapsInflation,
  fetchBoeMprInflationSeries,
  fetchBoeDailyInflationCompensation,
  fetchBoeAgentsPaySettlement,
} from "./boe-dmp";
import { fetchOnsPpiBulletin } from "./ons-ppi-bulletin";
import { fetchBlsSeries, fetchBlsSeriesFullHistory } from "./bls";
import { fetchPhiladelphiaLatest } from "./philadelphia";

import {
  blsReleaseFallbackPoints,
  fetchBlsCpiRelease,
  fetchBlsEmpsitRelease,
} from "./bls-releases";
import { fetchBeaNipa, fetchBeaNipaFullHistory } from "./bea";
import { fetchAdpNational } from "./adp";
import { fetchDolClaims } from "./dol-claims";
import { fetchGdpNow } from "./fed-regional";
import { fetchReleaseFeeds, mapFeedItemsToMetrics, type FeedItem } from "./rss";
import { applyTransform, round, type RawPoint } from "./transforms";
import { fetchNyfedSeries, type NyfedSeriesId } from "./nyfed";
import {
  fetchAtlantaBieSeries,
  fetchClevelandSofieSeries,
  fetchUmichPx5Series,
} from "./us-expectations";

export interface IngestSummary {
  runId: number;
  mode: "backfill" | "refresh";
  metricsProcessed: number;
  observationsUpserted: number;
  liveHits: number;
  fredFallbacks: number;
  failures: Array<{ metricId: string; error: string }>;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    region TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    description TEXT NOT NULL,
    source TEXT NOT NULL,
    series_id TEXT NOT NULL,
    transform TEXT NOT NULL,
    frequency TEXT NOT NULL,
    unit TEXT NOT NULL,
    importance TEXT NOT NULL,
    official_url TEXT NOT NULL,
    docs_url TEXT NOT NULL,
    release_name TEXT NOT NULL,
    earliest_available TEXT,
    last_ingested_at TEXT,
    observation_count INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id TEXT NOT NULL,
    date TEXT NOT NULL,
    value REAL NOT NULL,
    raw_value REAL,
    released_at TEXT,
    vintage_date TEXT,
    is_latest INTEGER DEFAULT 1,
    UNIQUE(metric_id, date, vintage_date)
  )`,
  `CREATE INDEX IF NOT EXISTS obs_metric_date_idx ON observations(metric_id, date)`,
  `CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id TEXT NOT NULL,
    period_date TEXT NOT NULL,
    released_at TEXT NOT NULL,
    value REAL NOT NULL,
    expected_value REAL,
    prior_period_value REAL,
    prior_period_date TEXT,
    prior_release_value REAL,
    change_vs_prior_period REAL,
    change_vs_prior_release REAL,
    supporting_doc_url TEXT,
    notes TEXT,
    UNIQUE(metric_id, period_date, released_at)
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'investing',
    country TEXT NOT NULL,
    currency TEXT,
    event_name TEXT NOT NULL,
    importance INTEGER,
    released_at TEXT NOT NULL,
    period_date TEXT,
    period_label TEXT,
    actual REAL,
    forecast REAL,
    previous REAL,
    raw_actual TEXT,
    raw_forecast TEXT,
    raw_previous TEXT,
    metric_id TEXT,
    dump_file TEXT,
    imported_at TEXT NOT NULL,
    UNIQUE(source, country, event_name, released_at)
  )`,
  `CREATE INDEX IF NOT EXISTS calendar_metric_idx ON calendar_events(metric_id)`,
  `CREATE INDEX IF NOT EXISTS calendar_released_idx ON calendar_events(released_at)`,
  `CREATE TABLE IF NOT EXISTS ingest_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    metrics_processed INTEGER DEFAULT 0,
    observations_upserted INTEGER DEFAULT 0,
    error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS source_handles (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'x',
    handle TEXT NOT NULL,
    display_name TEXT NOT NULL,
    region TEXT,
    role TEXT NOT NULL,
    notes TEXT
  )`,
];

async function ensureColumn(
  table: string,
  column: string,
  ddlType: string
): Promise<void> {
  const client = getClient();
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const exists = info.rows.some((r) => String(r.name) === column);
  if (!exists) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
  }
}

export async function ensureSchema(): Promise<void> {
  const client = getClient();
  for (const sql of DDL) {
    await client.execute(sql);
  }
  // Existing DBs created before expected_value
  await ensureColumn("releases", "expected_value", "REAL");
}

export async function seedCatalog(): Promise<void> {
  const db = getDb();
  const client = getClient();
  const catalogIds = new Set(METRICS.map((m) => m.id));

  for (const m of METRICS) {
    await db
      .insert(metrics)
      .values({
        id: m.id,
        region: m.region,
        category: m.category,
        subcategory: m.subcategory,
        name: m.name,
        shortName: m.shortName,
        description: m.description,
        source: m.source,
        seriesId: m.seriesId,
        transform: m.transform,
        frequency: m.frequency,
        unit: m.unit,
        importance: m.importance,
        officialUrl: m.officialUrl,
        docsUrl: m.docsUrl,
        releaseName: m.releaseName,
      })
      .onConflictDoUpdate({
        target: metrics.id,
        set: {
          name: m.name,
          shortName: m.shortName,
          description: m.description,
          seriesId: m.seriesId,
          transform: m.transform,
          officialUrl: m.officialUrl,
          docsUrl: m.docsUrl,
          releaseName: m.releaseName,
          importance: m.importance,
          subcategory: m.subcategory,
          category: m.category,
          region: m.region,
          source: m.source,
          frequency: m.frequency,
          unit: m.unit,
        },
      });
  }

  const existing = await db.select({ id: metrics.id }).from(metrics);
  for (const row of existing) {
    if (!catalogIds.has(row.id)) {
      await client.execute({
        sql: "DELETE FROM observations WHERE metric_id = ?",
        args: [row.id],
      });
      await client.execute({
        sql: "DELETE FROM releases WHERE metric_id = ?",
        args: [row.id],
      });
      await client.execute({
        sql: "DELETE FROM metrics WHERE id = ?",
        args: [row.id],
      });
    }
  }

  for (const h of X_HANDLES) {
    await db
      .insert(sourceHandles)
      .values({
        id: h.id,
        platform: "x",
        handle: h.handle,
        displayName: h.displayName,
        region: h.region,
        role: h.role,
        notes: h.notes,
      })
      .onConflictDoUpdate({
        target: sourceHandles.id,
        set: {
          handle: h.handle,
          displayName: h.displayName,
          notes: h.notes,
          role: h.role,
        },
      });
  }
}

function effectiveTransform(
  metric: MetricDef,
  opts?: { treatAsLevel?: boolean }
): Parameters<typeof applyTransform>[1] {
  if (opts?.treatAsLevel) return "level";
  if (metric.id === "us-nfp" || metric.id === "us-adp-change") return "diff";
  return metric.transform;
}

function scalePoints(metric: MetricDef, points: RawPoint[]): RawPoint[] {
  // ADP FRED levels are persons; live ADP change scrape may already be in thousands.
  if (metric.id === "us-adp-level") {
    return points.map((p) => ({
      ...p,
      value: p.value > 1_000_000 ? p.value / 1000 : p.value,
    }));
  }
  if (metric.id === "us-adp-change") {
    // If values look like persons (e.g. 44000), keep as thousands already from scrape
    // If from FRED persons level diff after /1000 scale upstream — handled in live loader
    return points;
  }
  return points;
}

function preparePoints(
  metric: MetricDef,
  raw: RawPoint[],
  opts?: { treatAsLevel?: boolean }
) {
  if (raw.length === 0) throw new Error("No observations returned");
  const scaled = scalePoints(metric, raw);
  const transformed = applyTransform(
    scaled,
    effectiveTransform(metric, opts)
  ).map((p) => ({
    ...p,
    value: round(p.value),
  }));
  const byDate = new Map<string, (typeof transformed)[number]>();
  for (const p of transformed) byDate.set(p.date, p);
  const unique = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, p]) => p);
  if (unique.length === 0) throw new Error("Transform produced no points");
  return unique;
}

async function writeReleaseRow(
  metric: MetricDef,
  unique: Array<{ date: string; value: number; rawValue: number }>,
  sourceNote: string,
  docsUrl?: string | null
) {
  const client = getClient();
  const now = new Date().toISOString();
  const latest = unique[unique.length - 1];
  const prior = unique.length > 1 ? unique[unique.length - 2] : null;

  let priorValue = prior?.value ?? null;
  let priorDate = prior?.date ?? null;
  if (!prior) {
    const prev = await client.execute({
      sql: `SELECT date, value FROM observations
            WHERE metric_id = ? AND date < ?
            ORDER BY date DESC LIMIT 1`,
      args: [metric.id, latest.date],
    });
    if (prev.rows[0]) {
      priorDate = String(prev.rows[0].date);
      priorValue = Number(prev.rows[0].value);
    }
  }
  if (!priorValue) {
    const prevRel = await client.execute({
      sql: `SELECT period_date, value FROM releases
            WHERE metric_id = ? AND period_date < ?
            ORDER BY period_date DESC, released_at DESC LIMIT 1`,
      args: [metric.id, latest.date],
    });
    if (prevRel.rows[0]) {
      priorDate = String(prevRel.rows[0].period_date);
      priorValue = Number(prevRel.rows[0].value);
    }
  }

  const existing = await client.execute({
    sql: `SELECT released_at, value, expected_value, prior_period_value, prior_period_date
          FROM releases
          WHERE metric_id = ? AND period_date = ?
          ORDER BY CASE WHEN notes LIKE 'investing calendar:%' THEN 0 ELSE 1 END,
                   released_at ASC
          LIMIT 1`,
    args: [metric.id, latest.date],
  });

  const releasedAt = existing.rows[0] ? String(existing.rows[0].released_at) : now;
  const expectedValue =
    existing.rows[0]?.expected_value != null ? Number(existing.rows[0].expected_value) : null;
  let priorReleaseValue: number | null = null;
  let changeVsPriorRelease: number | null = null;

  if (existing.rows[0]) {
    const oldVal = Number(existing.rows[0].value);
    if (Number.isFinite(oldVal) && Math.abs(oldVal - latest.value) > 0.001) {
      priorReleaseValue = oldVal;
      changeVsPriorRelease = round(latest.value - oldVal);
    }
    if (priorValue == null && existing.rows[0].prior_period_value != null) {
      priorValue = Number(existing.rows[0].prior_period_value);
      priorDate = String(existing.rows[0].prior_period_date);
    }
  }

  await client.execute({
    sql: `INSERT INTO releases (
            metric_id, period_date, released_at, value, expected_value,
            prior_period_value, prior_period_date,
            prior_release_value, change_vs_prior_release,
            change_vs_prior_period, supporting_doc_url, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(metric_id, period_date, released_at) DO UPDATE SET
            value=excluded.value,
            expected_value=COALESCE(excluded.expected_value, releases.expected_value),
            prior_period_value=COALESCE(excluded.prior_period_value, releases.prior_period_value),
            prior_period_date=COALESCE(excluded.prior_period_date, releases.prior_period_date),
            prior_release_value=COALESCE(excluded.prior_release_value, releases.prior_release_value),
            change_vs_prior_release=COALESCE(excluded.change_vs_prior_release, releases.change_vs_prior_release),
            change_vs_prior_period=COALESCE(excluded.change_vs_prior_period, releases.change_vs_prior_period),
            supporting_doc_url=excluded.supporting_doc_url,
            notes=CASE
              WHEN releases.notes LIKE 'investing calendar:%' THEN releases.notes
              ELSE excluded.notes
            END`,
    args: [
      metric.id,
      latest.date,
      releasedAt,
      latest.value,
      expectedValue,
      priorValue,
      priorDate,
      priorReleaseValue,
      changeVsPriorRelease,
      priorValue !== null ? round(latest.value - priorValue) : null,
      docsUrl || metric.docsUrl,
      sourceNote,
    ],
  });

  // Drop duplicate live rows for the same period (keep canonical released_at)
  await client.execute({
    sql: `DELETE FROM releases
          WHERE metric_id = ? AND period_date = ? AND released_at != ?`,
    args: [metric.id, latest.date, releasedAt],
  });
}

/** Full replace — used for historical backfill. */
async function persistMetricReplace(
  metric: MetricDef,
  raw: RawPoint[],
  sourceNote: string
): Promise<number> {
  const unique = preparePoints(metric, raw);
  const client = getClient();
  const now = new Date().toISOString();
  const vintage = now.slice(0, 10);

  await client.execute({
    sql: "DELETE FROM observations WHERE metric_id = ?",
    args: [metric.id],
  });

  const chunkSize = 400;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(",");
    const args: (string | number | null)[] = [];
    for (const p of chunk) {
      args.push(metric.id, p.date, p.value, p.rawValue, now, vintage);
    }
    await client.execute({
      sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest)
            VALUES ${placeholders}`,
      args,
    });
  }

  await getDb()
    .update(metrics)
    .set({
      earliestAvailable: unique[0].date,
      lastIngestedAt: now,
      observationCount: unique.length,
    })
    .where(eq(metrics.id, metric.id));

  await writeReleaseRow(metric, unique, sourceNote);
  return unique.length;
}

/** Merge upsert — used for live refresh so we don't wipe FRED history. */
async function persistMetricMerge(
  metric: MetricDef,
  raw: RawPoint[],
  sourceNote: string,
  opts?: { treatAsLevel?: boolean; docsUrl?: string | null }
): Promise<number> {
  const unique = preparePoints(metric, raw, opts);
  const client = getClient();
  const now = new Date().toISOString();
  const vintage = `live-${now.slice(0, 10)}`;

  // Bulk delete + insert for speed
  const dates = unique.map((p) => p.date);
  if (dates.length === 1) {
    await client.execute({
      sql: `DELETE FROM observations WHERE metric_id = ? AND date = ?`,
      args: [metric.id, dates[0]],
    });
  } else if (dates.length > 1) {
    const placeholders = dates.map(() => "?").join(",");
    await client.execute({
      sql: `DELETE FROM observations WHERE metric_id = ? AND date IN (${placeholders})`,
      args: [metric.id, ...dates],
    });
  }

  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const ph = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(",");
    const args: (string | number | null)[] = [];
    for (const p of chunk) {
      args.push(metric.id, p.date, p.value, p.rawValue, now, vintage);
    }
    await client.execute({
      sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest)
            VALUES ${ph}`,
      args,
    });
  }

  const countRes = await client.execute({
    sql: `SELECT COUNT(*) AS c, MIN(date) AS mn FROM observations WHERE metric_id = ?`,
    args: [metric.id],
  });
  const observationCount = Number(countRes.rows[0]?.c ?? unique.length);
  const earliestAvailable = String(countRes.rows[0]?.mn ?? unique[0].date);

  await getDb()
    .update(metrics)
    .set({
      earliestAvailable,
      lastIngestedAt: now,
      observationCount,
    })
    .where(eq(metrics.id, metric.id));

  await writeReleaseRow(metric, unique, sourceNote, opts?.docsUrl);
  return unique.length;
}

type BeaLiveFetch = {
  key: string;
  points: Promise<RawPoint[]>;
};

// A release/refresh cycle must use one BEA response per table/line/frequency.
// Derived MoM/YoY metrics and their underlying level metrics therefore share
// the exact same official BEA snapshot.
let officialSourceCycleActive = false;
const beaCycleCache = new Map<string, BeaLiveFetch>();

export function beginOfficialSourceCycle() {
  officialSourceCycleActive = true;
  beaCycleCache.clear();
}

export function endOfficialSourceCycle() {
  officialSourceCycleActive = false;
  beaCycleCache.clear();
}

async function fetchBeaForCycle(
  table: string,
  line: string,
  frequency: "Q" | "M" | "A"
): Promise<RawPoint[]> {
  const key = `${table}:${line}:${frequency}`;
  if (!officialSourceCycleActive) {
    return fetchBeaNipa(table, line, { frequency });
  }

  const cached = beaCycleCache.get(key);
  if (cached) return cached.points;

  const points = fetchBeaNipa(table, line, { frequency });
  beaCycleCache.set(key, { key, points });
  return points;
}

type LiveCaches = {
  bls: Map<string, RawPoint[]>;
  lseg: Map<string, Awaited<ReturnType<typeof fetchLsegLatest>>>;
  empsit?: Awaited<ReturnType<typeof fetchBlsEmpsitRelease>>;
  cpiRelease?: Awaited<ReturnType<typeof fetchBlsCpiRelease>> | null;
  adp?: { level: RawPoint[]; change: RawPoint[] };
  dol?: { initial: RawPoint[]; continuing: RawPoint[] };
  gdpNow?: RawPoint[];
  onsPpi?: Awaited<ReturnType<typeof fetchOnsPpiBulletin>>;
  rssByMetric?: Map<string, FeedItem>;
};

async function warmLiveCaches(targets: MetricDef[] = METRICS, options?: { skipFeeds?: boolean }): Promise<LiveCaches> {
  const caches: LiveCaches = { bls: new Map(), lseg: new Map() };

  const providers = new Set<string>();

  for (const metric of targets) {
    const mapped = LIVE_MAP[metric.id];
    const ref = getD1Database() && mapped?.provider === "lseg" ? undefined : mapped;

    if (ref) {
      providers.add(ref.provider);
    } else if (metric.source) {
      providers.add(metric.source);
    }
  }

  // Official release RSS/Atom — docs + release awareness
  if (!options?.skipFeeds) try {
    const feedItems = await fetchReleaseFeeds();
    caches.rssByMetric = mapFeedItemsToMetrics(feedItems);

    console.log(
      `[live] RSS feeds items=${feedItems.length} metricLinks=${caches.rssByMetric.size}`
    );
  } catch (err) {
    console.warn(`[live] RSS feeds failed:`, err);
  }

  /*
   * IMPORTANT:
   * Only request BLS series belonging to the metrics being ingested.
   *
   * Previously this used:
   *   liveSeriesIdsForProvider("bls")
   *
   * which fetched every BLS series in LIVE_MAP even when the user
   * requested only a small set of metrics.
   */
  const blsIds =
    providers.has("bls")
      ? [
          ...new Set(
            targets
              .map((metric) => {
                const ref = LIVE_MAP[metric.id];
                if (ref?.provider === "bls") return ref.seriesId;
                return metric.source === "bls" ? metric.seriesId : null;
              })
              .filter((id): id is string => Boolean(id))
          ),
        ]
      : [];

  if (blsIds.length) {
    try {
      caches.bls = await fetchBlsSeries(blsIds, {
        startYear: new Date().getFullYear() - 3,
      });

      console.log(
        `[live] BLS API requested ${blsIds.length} series, fetched ${caches.bls.size} series`
      );
    } catch (err) {
      console.warn(`[live] BLS API failed (will use release pages):`, err);
    }
  }

  // Also warm the official release-page fallbacks when the API returns a
  // partial set (for example, after its daily quota is reached midway).
  // The API remains preferred per series; these pages fill only missing IDs.
  const needsEmpsitFallback = targets.some((metric) =>
    ["us-nfp", "us-unemployment"].includes(metric.id)
  );
  const needsCpiFallback = targets.some((metric) =>
    ["us-cpi-mom", "us-cpi-yoy", "us-core-cpi-mom", "us-core-cpi-yoy"].includes(metric.id)
  );
  if (providers.has("bls") && needsEmpsitFallback) {
    try {
      caches.empsit = await fetchBlsEmpsitRelease();

      console.log(
        `[live] BLS empsit NFP=${caches.empsit.nfpChange?.value} U3=${caches.empsit.unemployment?.value}`
      );
    } catch (err) {
      console.warn(`[live] BLS empsit HTML failed:`, err);
    }

  }
  if (providers.has("bls") && needsCpiFallback) {
    try {
      caches.cpiRelease = await fetchBlsCpiRelease();
      console.log(`[live] BLS CPI release period=${caches.cpiRelease.period}`);
    } catch (err) {
      caches.cpiRelease = null;
      console.warn(`[live] BLS CPI HTML failed:`, err);
    }
  }

  if (providers.has("adp")) {
    try {
      caches.adp = await fetchAdpNational();

      console.log(
        `[live] ADP JSON change=${caches.adp.change.length} level=${caches.adp.level.length}`,
        caches.adp.change.at(-1)
      );
    } catch (err) {
      console.warn(`[live] ADP failed:`, err);
    }
  }

  if (providers.has("dol")) {
    try {
      caches.dol = await fetchDolClaims();

      console.log(
        `[live] DOL claims initial=${caches.dol.initial.at(-1)?.value} continuing=${caches.dol.continuing.at(-1)?.value}`
      );
    } catch (err) {
      console.warn(`[live] DOL claims failed:`, err);
    }
  }

  if (providers.has("atlanta_gdpnow")) {
    try {
      caches.gdpNow = await fetchGdpNow();
      console.log(`[live] GDPNow`, caches.gdpNow.at(-1));
    } catch (err) {
      console.warn(`[live] GDPNow failed:`, err);
    }
  }

  if (providers.has("ons") && targets.some(metric => metric.id.startsWith("uk-ppi-"))) {
    try {
      caches.onsPpi = await fetchOnsPpiBulletin();

      console.log(
        `[live] ONS PPI bulletin in=${caches.onsPpi.inputYoy?.value} out=${caches.onsPpi.outputYoy?.value}`
      );
    } catch (err) {
      console.warn(`[live] ONS PPI bulletin failed:`, err);
    }
  }

  return caches;
}


/**
 * Eurostat EA jobs aliases.
 *
 * The catalog uses stable internal aliases:
 *   - ea_inactivity_rate
 *   - ea_job_vacancy_rate
 *
 * Those are NOT native Eurostat dataset codes. The existing pipeline was
 * sending them directly to fetchEurostatPreset(), so the Eurostat adapter
 * could not resolve them and the cards ended up with no observations.
 *
 * These two helpers query the official Eurostat dissemination API directly.
 * They use EA21 (the euro-area aggregate from 2026), the current quarterly
 * datasets, and return the same RawPoint[] shape used by the rest of the
 * pipeline. Existing Eurostat metrics continue to use fetchEurostatPreset().
 */

type EurostatJsonStat = {
  id?: string[];
  size?: number[];
  dimension?: Record<string, {
    category?: {
      index?: Record<string, number> | string[];
      label?: Record<string, string>;
    };
  }>;
  value?: Record<string, number> | number[];
};

function eurostatCategoryCodes(
  dimension: EurostatJsonStat["dimension"],
  id: string
): string[] {
  const category = dimension?.[id]?.category;
  if (!category?.index) return [];
  if (Array.isArray(category.index)) return category.index;
  return Object.entries(category.index)
    .sort((a, b) => a[1] - b[1])
    .map(([code]) => code);
}

function eurostatJsonStatToPoints(data: EurostatJsonStat): RawPoint[] {
  const ids = data.id ?? [];
  const sizes = data.size ?? [];
  const dimensions = data.dimension ?? {};
  const timeIndex = ids.indexOf("time");

  if (timeIndex < 0 || !sizes.length || !data.value) {
    throw new Error("Eurostat JSON-stat response is missing time/value dimensions");
  }

  const timeCodes = eurostatCategoryCodes(dimensions, "time");
  const values = data.value;
  const points: RawPoint[] = [];

  const valueAt = (flatIndex: number): number | null => {
    if (Array.isArray(values)) {
      const value = values[flatIndex];
      return Number.isFinite(value) ? Number(value) : null;
    }
    const value = values[String(flatIndex)];
    return Number.isFinite(value) ? Number(value) : null;
  };

  // JSON-stat stores a multidimensional cube as one flat array. All
  // non-time dimensions are fixed to one position by our API filters.
  const strides = sizes.map((_, i) =>
    sizes.slice(i + 1).reduce((acc, n) => acc * n, 1)
  );

  for (let t = 0; t < timeCodes.length; t += 1) {
    const flatIndex = t * strides[timeIndex];
    const value = valueAt(flatIndex);
    if (value == null) continue;

    points.push({
      date: timeCodes[t],
      value,
    });
  }

  if (!points.length) {
    throw new Error("Eurostat JSON-stat response contained no numeric observations");
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchEurostatJsonStat(
  dataset: string,
  filters: Record<string, string>
): Promise<RawPoint[]> {
  const url = new URL(
    `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}`
  );
  url.searchParams.set("lang", "en");
  url.searchParams.set("format", "JSON");

  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "macro-economy-tracker/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Eurostat ${dataset} request failed (${response.status})`
    );
  }

  const json = await response.json() as EurostatJsonStat;
  return eurostatJsonStatToPoints(json);
}

async function fetchEurostatEaInactivityRate(): Promise<RawPoint[]> {
  // SA is preferred. If the current table has no SA aggregate for a period,
  // fall back to the published NSA series rather than returning a blank card.
  const common = {
    geo: "EA21",
    freq: "Q",
    indic_em: "INAC",
    sex: "T",
    age: "Y15-74",
    unit: "PC_POP",
  };

  try {
    return await fetchEurostatJsonStat("lfsi_act_q", {
      ...common,
      s_adj: "SA",
    });
  } catch {
    return fetchEurostatJsonStat("lfsi_act_q", {
      ...common,
      s_adj: "NSA",
    });
  }
}

async function fetchEurostatEaJobVacancyRate(): Promise<RawPoint[]> {
  // Eurostat's current JVS dataset uses NACE Rev. 2.1 and the whole economy
  // aggregate B-T. SA is the preferred official headline series.
  const common = {
    geo: "EA21",
    freq: "Q",
    indic_em: "JVR",
    sizeclas: "TOTAL",
    nace_r21: "B-T",
  };

  try {
    return await fetchEurostatJsonStat("jvs_q_r21", {
      ...common,
      s_adj: "SA",
    });
  } catch {
    return fetchEurostatJsonStat("jvs_q_r21", {
      ...common,
      s_adj: "NSA",
    });
  }
}

async function fetchEurostatPresetForSeriesId(seriesId: string): Promise<RawPoint[]> {
  if (seriesId === "ea_inactivity_rate") {
    return fetchEurostatEaInactivityRate();
  }

  if (seriesId === "ea_job_vacancy_rate") {
    return fetchEurostatEaJobVacancyRate();
  }

  return fetchEurostatPreset(seriesId);
}

async function loadLiveRaw(
  metric: MetricDef,
  caches: LiveCaches
): Promise<{ points: RawPoint[]; note: string } | null> {
  const mapped = LIVE_MAP[metric.id];
  const ref = getD1Database() && mapped?.provider === "lseg" ? undefined : mapped;
  if (!ref) {
    // Catalog-native BLS series that do not need a special release parser.
    if (metric.source === "bls") {
      const points = caches.bls.get(metric.seriesId);
      if (points?.length) {
        return { points, note: `Live BLS API ${metric.seriesId}` };
      }
      return null;
    }

    if (metric.source === "philadelphia") {
      const latest = await fetchPhiladelphiaLatest(metric.seriesId);
      return {
        points: [
          {
            date: latest.periodDate,
            value: latest.value,
          },
        ],
        note: latest.note,
      };
    }

    // Catalog native official sources
    if (metric.source === "bea") {
      const [table, line] = metric.seriesId.split(":");
      if (!table || !line) return null;
      const points = await fetchBeaForCycle(
        table,
        line,
        metric.frequency === "monthly" ? "M" : metric.frequency === "annual" ? "A" : "Q"
      );
      return { points, note: `Live BEA ${metric.seriesId}` };
    }

    if (metric.source === "fred") {
      const points = await fetchFredSeries(metric.seriesId);
      return { points: points.points, note: `Live FRED ${metric.seriesId}` };
    }

    if (metric.source === "census") {
      return {
        points: await fetchCensusRetailSeries(metric.id),
        note: `Live Census MARTS ${metric.seriesId}`,
      };
    }

    if (metric.source === "pmi_scrape") {
      return {
        points: await fetchPmiMetric(
          metric.id as PmiMetricKey
        ),
        note: `Live PMI scrape ${metric.id}`,
      };
    }
    if (metric.source === "ons") {
      await new Promise((r) => setTimeout(r, 2000));
      return {
        points: await fetchOnsSeries(metric.seriesId),
        note: "Live ONS",
      };
    }
    if (metric.source === "eurostat") {
      return {
        points: await fetchEurostatPresetForSeriesId(metric.seriesId),
        note: "Live Eurostat",
      };
    }
    if (metric.source === "ecb") {
      return {
        points: await fetchEcbBySeriesId(metric.seriesId),
        note: `Live ECB ${metric.seriesId}`,
      };
    }
    if (metric.source === "boe") {
      return {
        points: await fetchBoeBySeriesId(metric.seriesId),
        note: `Live BoE ${metric.seriesId}`,
      };
    }
    if (metric.source === "nyfed") {
      return {
        points: await fetchNyfedSeries(metric.seriesId as NyfedSeriesId),
        note: `Live NY Fed SCE ${metric.seriesId}`,
      };
    }
    if (metric.source === "atlanta") {
      if (metric.seriesId === "BIE_EXPECTED_PRICE_1Y") {
        return {
          points: await fetchAtlantaBieSeries("price"),
          note: "Live Atlanta Fed BIE price expectations",
        };
      }
      if (metric.seriesId === "BIE_EXPECTED_UNIT_COST_1Y") {
        return {
          points: await fetchAtlantaBieSeries("unit-cost"),
          note: "Live Atlanta Fed BIE unit-cost expectations",
        };
      }
    }
    if (metric.source === "cleveland_sofie") {
      return {
        points: await fetchClevelandSofieSeries(metric.seriesId === "SOFIE_5Y" ? "5y" : "1y"),
        note: `Live Cleveland Fed SoFIE ${metric.seriesId}`,
      };
    }
    if (metric.source === "umich" && metric.seriesId === "PX5") {
      return {
        points: await fetchUmichPx5Series(),
        note: "Live University of Michigan PX5",
      };
    }
    return null;
  }

  switch (ref.provider) {
    case "bls": {
      const pts = caches.bls.get(ref.seriesId);
      if (pts?.length) {
        return { points: pts, note: `Live BLS API ${ref.seriesId}` };
      }
      // API down / empty → official release HTML
      if (caches.empsit || caches.cpiRelease) {
        const scraped = blsReleaseFallbackPoints(
          metric.id,
          caches.empsit ?? {
            nfpChange: null,
            unemployment: null,
            period: null,
          },
          caches.cpiRelease ?? null
        );
        if (scraped?.length) {
          return { points: scraped, note: `Live BLS release page (${metric.id})` };
        }
      }
      return null;
    }
    case "adp": {
      if (!caches.adp) return null;
      if (ref.seriesId === "change") {
        // Prefer explicit change series; else derive from level in persons→thousands
        if (caches.adp.change.length) {
        return { points: caches.adp.change, note: "Live ADP JSON API (change)" };
        }
        if (caches.adp.level.length >= 2) {
          const lvl = caches.adp.level.map((p) => ({
            ...p,
            value: p.value > 1_000_000 ? p.value / 1000 : p.value,
          }));
          return { points: lvl, note: "Live ADP scrape (level→diff)" };
        }
        return null;
      }
      if (ref.seriesId === "level" && caches.adp.level.length) {
        return { points: caches.adp.level, note: "Live ADP scrape (level)" };
      }
      return null;
    }
    case "dol": {
      if (!caches.dol) return null;
      if (ref.seriesId === "initial" && caches.dol.initial.length) {
        return { points: caches.dol.initial, note: "Live DOL ETA claims" };
      }
      if (ref.seriesId === "continuing" && caches.dol.continuing.length) {
        return { points: caches.dol.continuing, note: "Live DOL ETA claims" };
      }
      return null;
    }
    case "atlanta_gdpnow": {
      if (!caches.gdpNow?.length) return null;
      return { points: caches.gdpNow, note: "Live Atlanta Fed GDPNow" };
    }
    case "bea": {
      if (!process.env.BEA_API_KEY) return null;
      const [table, line] = ref.seriesId.split(":");
      const freq = metric.frequency === "monthly" ? "M" : "Q";
      const points = await fetchBeaForCycle(table, line, freq);
      return { points, note: `Live BEA ${ref.seriesId}` };
    }
    case "ons": {
      // Prefer bulletin headlines for PPI annual rates (authoritative on release day)
      if (metric.id === "uk-ppi-input-yoy" && caches.onsPpi?.inputYoy) {
        return {
          points: [caches.onsPpi.inputYoy],
          note: "Live ONS PPI bulletin (input YoY)",
        };
      }
      if (metric.id === "uk-ppi-output-yoy" && caches.onsPpi?.outputYoy) {
        return {
          points: [caches.onsPpi.outputYoy],
          note: "Live ONS PPI bulletin (output YoY)",
        };
      }
      await new Promise((r) => setTimeout(r, 400));
      return {
        points: await fetchOnsSeries(ref.seriesId),
        note: `Live ONS ${ref.seriesId}`,
      };
    }
    case "eurostat": {
      return {
        points: await fetchEurostatPresetForSeriesId(ref.seriesId),
        note: `Live Eurostat ${ref.seriesId}`,
      };
    }
    case "ecb": {
      const points = await fetchEcbBySeriesId(ref.seriesId);
      return { points, note: `Live ECB ${ref.seriesId}` };
    }
    case "boe": {
      const points = await fetchBoeBySeriesId(ref.seriesId);
      return { points, note: `Live BoE ${ref.seriesId}` };
    }
    case "nyfed": {
      const points = await fetchNyfedSeries(
        ref.seriesId as NyfedSeriesId,
      );

      return {
        points,
        note: `Live NY Fed SCE ${ref.seriesId}`,
      };
    }
    case "lseg": {
      // LSEG is intentionally latest-value only. Historical observations
      // remain unavailable until a historical LSEG adapter is added.
      if (caches.lseg.has(ref.seriesId)) {
        const latest = caches.lseg.get(ref.seriesId);
        if (!latest) return null;

        return {
          points: [
            {
              date: latest.periodDate,
              value: latest.value,
            },
          ],
          note: latest.note,
        };
      }

      const latest = await fetchLsegLatest(ref.seriesId);
      caches.lseg.set(ref.seriesId, latest);

      if (!latest) return null;

      return {
        points: [
          {
            date: latest.periodDate,
            value: latest.value,
          },
        ],
        note: latest.note,
      };
    }
    default:
      return null;
  }
}

export async function fetchOfficialLatestFromPipeline(metricId: string) {
  const metric = METRICS.find((m) => m.id === metricId);
  if (!metric) throw new Error(`Unknown metric ${metricId}`);

  const caches = await warmLiveCaches([metric], { skipFeeds: true });
  const live = await loadLiveRaw(metric, caches);
  if (!live?.points?.length) return null;

  const treatAsLevel =
    metric.id === "us-eci-wages" ||
    live.note.includes("(change)") ||
    live.note.includes("release page") ||
    live.note.includes("PPI bulletin");

  const prepared = preparePoints(metric, live.points, { treatAsLevel });
  const latest = prepared.at(-1);
  if (!latest) return null;

  return {
    periodDate: latest.date,
    value: latest.value,
    rawValue: latest.rawValue,
    releasedAt: new Date().toISOString(),
    note: live.note,
  };
}

async function loadFredRaw(
  metric: MetricDef,
  fredCache: Map<string, RawPoint[]>
): Promise<RawPoint[]> {
  const series = metric.fallbackSeriesId ?? (metric.source === "fred" ? metric.seriesId : null);
  if (series) {
    if (!fredCache.has(series)) {
      const result = await fetchFredSeries(series);
      fredCache.set(series, result.points);
    }
    return fredCache.get(series)!;
  }
  if (metric.source === "eurostat") return fetchEurostatPresetForSeriesId(metric.seriesId);
  if (metric.source === "ons") {
    await new Promise((r) => setTimeout(r, 2000));
    return fetchOnsSeries(metric.seriesId);
  }
  if (metric.source === "ecb") return fetchEcbBySeriesId(metric.seriesId);
  if (metric.source === "boe") return fetchBoeBySeriesId(metric.seriesId);
  throw new Error(`No FRED fallback configured for ${metric.id}`);
}


async function loadOfficialHistory(metric: MetricDef): Promise<RawPoint[]> {
  const endYear = new Date().getFullYear();
  if (metric.source === "census") {
    return fetchCensusRetailSeries(metric.id);
  }

  if (metric.source === "pmi_scrape") {
    return fetchPmiMetric(
      metric.id as PmiMetricKey
    );
  }
  if (metric.source === "bls") {
    const map = await fetchBlsSeriesFullHistory([metric.seriesId], {
      startYear: 1947,
      endYear,
      windowYears: 10,
    });
    return map.get(metric.seriesId) ?? [];
  }

  if (metric.source === "bea") {
    const [table, line] = metric.seriesId.split(":");
    return fetchBeaNipaFullHistory(table, line, {
      frequency: metric.frequency === "quarterly" ? "Q" : "M",
      startYear: 1959,
      endYear,
    });
  }

  if (metric.source === "ons") {
    return fetchOnsSeries(metric.seriesId);
  }

  if (metric.source === "eurostat") {
    return fetchEurostatPresetForSeriesId(metric.seriesId);
  }

  if (metric.source === "ecb") {
    return fetchEcbBySeriesId(metric.seriesId);
  }

  if (metric.source === "boe") {
    return fetchBoeBySeriesId(metric.seriesId);
  }
  if (metric.source === "nyfed") {
    return fetchNyfedSeries(metric.seriesId as NyfedSeriesId);
  }

  // LSEG adapter is intentionally latest-value only. Do not pretend it
  // provides historical backfill.
  if (metric.source === "lseg") {
    return [];
  }

  if (metric.source === "atlanta" && metric.seriesId === "BIE_EXPECTED_PRICE_1Y") {
    return fetchAtlantaBieSeries();
  }
  if (metric.source === "cleveland_sofie") {
    return fetchClevelandSofieSeries(metric.seriesId === "SOFIE_5Y" ? "5y" : "1y");
  }
  if (metric.source === "umich" && metric.seriesId === "PX5") {
    return fetchUmichPx5Series();
  }

  return [];
}

async function loadPrimaryOrFallback(
  metric: MetricDef,
  fredCache: Map<string, RawPoint[]>
): Promise<{ points: RawPoint[]; via: "primary" | "fred" }> {
  // FRED is a primary source only for metrics explicitly catalogued as FRED.
  // Official-source metrics must never silently downgrade to FRED.
  if (metric.source === "fred") {
    return { points: await loadFredRaw(metric, fredCache), via: "fred" };
  }

  const points = await loadOfficialHistory(metric);
  if (!points.length) {
    throw new Error(`Official ${metric.source.toUpperCase()} provider returned no observations for ${metric.id}`);
  }
  return { points, via: "primary" };
}

async function fetchEcbBySeriesId(seriesId: string): Promise<RawPoint[]> {
  // ---------------------------------------------------------------------------
  // ECB Consumer Expectations Survey (CES)
  // ---------------------------------------------------------------------------
  if (seriesId === "CES_HICP_1Y") {
    return fetchEcbCesInflation1y();
  }

  if (seriesId === "CES_HICP_3Y") {
    return fetchEcbCesInflation3y();
  }

  if (seriesId === "CES_HICP_5Y") {
    return fetchEcbCesInflation5y();
  }

  // ---------------------------------------------------------------------------
  // ECB Wage Tracker / SAFE
  // ---------------------------------------------------------------------------
  if (
    seriesId === "EWT.M.U2.N.WT.INWS._T.4F0.GY" ||
    seriesId === "EWT.M.U2.N.WT.INWX._T.4F0.GY"
  ) {
    return fetchEcbSdmxSeries("EWT", seriesId);
  }

  if (seriesId === "SAFE_SELLING_PRICE_EXP_1Y") {
    return fetchEcbSafeSellingPriceExpectations();
  }

  if (seriesId === "SAFE_INPUT_COST_EXP_1Y") {
    return fetchEcbSafeInputCostExpectations();
  }

  if (seriesId === "SAFE_WAGE_EXP_1Y") {
    return fetchEcbSafeWageExpectations();
  }

  // ---------------------------------------------------------------------------
  // ECB Survey of Professional Forecasters (SPF)
  // ---------------------------------------------------------------------------
  if (seriesId === "SPF_HICP_CURRENT_YEAR") {
    return fetchEcbSdmxSeries("SPF", "A.U2.HICP.POINT.P9M.Q.AVG");
  }

  if (seriesId === "SPF_HICP_P12M") {
    return fetchEcbSpfSeries("SPF_HICP_P12M");
  }

  if (seriesId === "SPF_HICP_2Y" || seriesId === "SPF_HICP_P24M") {
    return fetchEcbSdmxSeries("SPF", "M.U2.HICP.POINT.P24M.Q.AVG");
  }

  if (seriesId === "SPF_CORE_P12M") {
    return fetchEcbSpfSeries("SPF_CORE_P12M");
  }

  if (seriesId === "SPF_HICP_LT") {
    return fetchEcbSpfSeries("SPF_HICP_LT");
  }

  if (seriesId === "SPF_ASSU_LAB_P12M") {
    return fetchEcbSpfSeries("SPF_ASSU_LAB_P12M");
  }

  // ---------------------------------------------------------------------------
  // EA market-based inflation compensation
  //
  // These IDs are catalog aliases rather than native ECB SDMX series keys.
  // Keep the dispatch explicit so they cannot silently fall through to an
  // unrelated ECB series.
  // ---------------------------------------------------------------------------
  if (
    seriesId === "EA_INFL_COMP_1Y" ||
    seriesId === "EA_INFL_COMP_2Y" ||
    seriesId === "EA_INFL_COMP_5Y5Y"
  ) {
    throw new Error(
      `ECB market-series adapter is not configured for ${seriesId}. ` +
      `Add the LSEG mapping in src/catalog/live-map.ts when the RIC is available.`
    );
  }

  throw new Error(`Unknown ECB series ${seriesId}`);
}

/**
 * Generic ECB SDMX-JSON/CSV-compatible series loader for native ECB series keys
 * that are not exposed as dedicated helpers in ecb-spf.ts.
 *
 * This deliberately accepts only full ECB SDMX series keys. Catalog aliases
 * such as SAFE_* and EA_INFL_COMP_* are handled above by dedicated adapters.
 */
async function fetchEcbSdmxSeries(
  flow: string,
  seriesKey: string
): Promise<RawPoint[]> {
  const BASE = "https://data-api.ecb.europa.eu/service/data";

  // ECB's REST endpoint takes the dataflow and then the series key
  // without the dataflow prefix. Some catalog entries are stored as
  // full keys (e.g. EWT.M.U2...), while others are already relative
  // (e.g. M.U2...). Normalize both forms here.
  const prefix = `${flow}.`;
  const normalizedKey = seriesKey.startsWith(prefix)
    ? seriesKey.slice(prefix.length)
    : seriesKey;

  const url =
    `${BASE}/${encodeURIComponent(flow)}/` +
    `${encodeURIComponent(normalizedKey)}?format=csvdata`;

  const response = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "macro-economy-tracker/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `ECB SDMX request failed (${response.status}) for ${flow}.${normalizedKey}`
    );
  }

  const csv = await response.text();
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error(
      `ECB SDMX returned no observations for ${flow}.${normalizedKey}`
    );
  }

  const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ""));
  const timeIndex = header.findIndex((x) => x === "TIME_PERIOD");
  const valueIndex = header.findIndex((x) => x === "OBS_VALUE");

  if (timeIndex < 0 || valueIndex < 0) {
    throw new Error(
      `ECB SDMX CSV schema missing TIME_PERIOD/OBS_VALUE for ${flow}.${normalizedKey}`
    );
  }

  const points: RawPoint[] = [];

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const date = cols[timeIndex]?.trim();
    const raw = Number(cols[valueIndex]);

    if (!date || !Number.isFinite(raw)) continue;

    points.push({
      date,
      value: raw,
    });
  }

  if (!points.length) {
    throw new Error(
      `ECB SDMX returned no numeric observations for ${flow}.${normalizedKey}`
    );
  }

  return points;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

async function fetchBoeBySeriesId(seriesId: string) {
  if (seriesId === "UK_INFL_COMP_5Y5Y") {
    return fetchBoeDailyInflationCompensation(seriesId);
  }
  // BoE Inflation Attitudes Survey
  if (seriesId === "IAS_Q2A") {
    return fetchBoeInflationExpectations("1y");
  }

  if (seriesId === "IAS_Q2B") {
    return fetchBoeInflationExpectations("2y");
  }

  if (seriesId === "IAS_Q2C") {
    return fetchBoeInflationExpectations("5y");
  }

  // BoE DMP wage series
  if (
    seriesId === "DMP_WAGE_REALISED_3M" ||
    seriesId === "DMP_WAGE_EXPECTED_3M" ||
    seriesId === "DMP_WAGE_REALISED_1M" ||
    seriesId === "DMP_WAGE_EXPECTED_1M"
  ) {
    return fetchBoeDmpWages(seriesId);
  }

  // BoE DMP inflation / own-price expectations
  if (
    seriesId === "DMP_CPI_EXPECTED_1Y" ||
    seriesId === "DMP_CPI_EXPECTED_3Y" ||
    seriesId === "DMP_OWN_PRICE_EXPECTED_1Y" ||
    seriesId === "DMP_WAGE_EXPECTED_1Y"
  ) {
    return fetchBoeDmpSeries(seriesId);
  }

  // BoE Market Participants Survey
  if (
    seriesId === "MAPS_CPI_1Y" ||
    seriesId === "MAPS_CPI_2Y" ||
    seriesId === "MAPS_CPI_3Y" ||
    seriesId === "MAPS_CPI_5Y"
  ) {
    return fetchBoeMapsInflation(seriesId);
  }

  // Citi / YouGov and UK inflation compensation
  if (
    seriesId === "CITI_YOUGOV_INFLATION_1Y" ||
    seriesId === "CITI_YOUGOV_INFLATION_5_10Y" ||
    seriesId === "UK_INFL_COMP_1Y"
  ) {
    return fetchBoeMprInflationSeries(seriesId);
  }

  // BoE Agents
  if (seriesId === "AGENTS_PAY_SETTLEMENT_EXPECTED_1Y") {
    return fetchBoeAgentsPaySettlement();
  }

  throw new Error(`Unknown BoE series ${seriesId}`);
}
export async function runIngest(
  mode: "backfill" | "refresh",
  opts?: { metricIds?: string[] }
): Promise<IngestSummary> {
  await ensureSchema();
  await seedCatalog();

  const db = getDb();
  const startedAt = new Date().toISOString();
  await db.insert(ingestRuns).values({
    startedAt,
    mode,
    status: "running",
    metricsProcessed: 0,
    observationsUpserted: 0,
  });
  const runRow = (
    await db.select().from(ingestRuns).orderBy(desc(ingestRuns.id)).limit(1)
  )[0];
  const runId = runRow?.id ?? 0;

  const failures: IngestSummary["failures"] = [];
  let metricsProcessed = 0;
  let observationsUpserted = 0;
  let liveHits = 0;
  let fredFallbacks = 0;

  const fredCache = new Map<string, RawPoint[]>();

  const requestedTargets = opts?.metricIds?.length
    ? METRICS.filter((m) => opts.metricIds!.includes(m.id))
    : METRICS;

  // These three EA market-based expectation metrics are intentionally deferred
  // until their real LSEG RICs are added to LIVE_MAP. Do not let a full
  // backfill/refresh fail because the catalog aliases are not native ECB SDMX
  // series. Once a LIVE_MAP LSEG mapping exists, they automatically become
  // eligible again.
  const deferredEaMarketMetricIds = new Set([
    "ea-inflation-comp-1y",
    "ea-inflation-comp-2y",
    "ea-inflation-comp-5y5y",
  ]);

  const targets = requestedTargets.filter((metric) => {
    if (deferredEaMarketMetricIds.has(metric.id) && !LIVE_MAP[metric.id]) {
      console.log(
        `[ingest] Skipping deferred EA market metric ${metric.id} — LSEG RIC not configured`
      );
      return false;
    }
    return true;
  });

  if (targets.length === 0) throw new Error("No metrics matched ingest filter");

  const liveCaches: LiveCaches =
  mode === "refresh"
    ? await warmLiveCaches(targets)
    : { bls: new Map(), lseg: new Map() };

  const results = await mapPool(targets, mode === "refresh" ? 2 : 1, async (metric) => {
    try {
      if (mode === "refresh") {
        try {
          const live = await loadLiveRaw(metric, liveCaches);
          if (live?.points.length) {
            const headline =
              metric.id === "us-eci-wages" ||
              live.note.includes("(change)") ||
              live.note.includes("release page") ||
              live.note.includes("PPI bulletin");
            const rss = liveCaches.rssByMetric?.get(metric.id);
            const count = await persistMetricMerge(metric, live.points, live.note, {
              treatAsLevel: headline,
              docsUrl: rss?.link ?? metric.docsUrl,
            });
            return { ok: true as const, metricId: metric.id, count, via: "live" as const };
          }
        } catch (err) {
          console.warn(
            `[live] ${metric.id} official fetch failed:`,
            err instanceof Error ? err.message : err
          );
        }

        if (metric.source === "fred") {
          const raw = await loadFredRaw(metric, fredCache);
          const tip = raw.slice(-36);
          const count = await persistMetricMerge(metric, tip, "FRED source (recent tip)", {
            docsUrl: liveCaches.rssByMetric?.get(metric.id)?.link ?? metric.docsUrl,
          });
          return { ok: true as const, metricId: metric.id, count, via: "fred" as const };
        }

        throw new Error(`Official ${metric.source.toUpperCase()} live fetch failed; no FRED fallback is permitted for ${metric.id}`);
      }

      const primary = await loadPrimaryOrFallback(metric, fredCache);
      const count = await persistMetricReplace(
        metric,
        primary.points,
        primary.via === "primary"
          ? `Historical backfill — ${metric.source.toUpperCase()}`
          : "Historical backfill — FRED fallback"
      );
      return {
        ok: true as const,
        metricId: metric.id,
        count,
        via: primary.via === "primary" ? "live" as const : "fred" as const,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ingest] ${metric.id}: ${message}`);
      return { ok: false as const, metricId: metric.id, error: message };
    }
  });

  for (const r of results) {
    if (r.ok) {
      metricsProcessed += 1;
      observationsUpserted += r.count;
      if (r.via === "live") liveHits += 1;
      else fredFallbacks += 1;
    } else {
      failures.push({ metricId: r.metricId, error: r.error });
    }
  }

  if (mode === "refresh") endOfficialSourceCycle();

  const finishedAt = new Date().toISOString();
  await db
    .update(ingestRuns)
    .set({
      finishedAt,
      status: failures.length && metricsProcessed === 0 ? "error" : "ok",
      metricsProcessed,
      observationsUpserted,
      error: JSON.stringify({
        liveHits,
        fredFallbacks,
        failures: failures.slice(0, 30),
      }),
    })
    .where(eq(ingestRuns.id, runId));

  return {
    runId,
    mode,
    metricsProcessed,
    observationsUpserted,
    liveHits,
    fredFallbacks,
    failures,
  };
}

/** Prefer release row for the latest observation period; ignore other periods' calendar dates. */
function pickDisplayRelease(
  rows: Array<{
    periodDate: string;
    releasedAt: string;
    notes: string | null;
    expectedValue?: number | null;
    priorPeriodValue?: number | null;
    priorPeriodDate?: string | null;
    value?: number;
  }>,
  latestPeriod: string | null
) {
  const isInvesting = (r: (typeof rows)[number]) =>
    (r.notes ?? "").includes("investing calendar:");
  const score = (r: (typeof rows)[number]) =>
    (r.expectedValue != null ? 4 : 0) +
    (isInvesting(r) ? 2 : 0) +
    (r.priorPeriodValue != null ? 1 : 0);

  if (latestPeriod) {
    const pool = rows.filter((r) => r.periodDate === latestPeriod);
    if (pool.length) {
      return [...pool].sort((a, b) => score(b) - score(a))[0];
    }
  }
  const investing = rows.find(isInvesting);
  if (investing) return investing;
  return rows[0] ?? null;
}

export async function getReleaseTape(opts?: {
  days?: number;
  region?: string;
  kind?: "all" | "data" | "speakers" | "policy";
  forwardOnly?: boolean;
}) {
  await ensureSchema();
  const db = getDb();
  const days = opts?.days ?? 7;
  const now = new Date();
  const forwardOnly = opts?.forwardOnly !== false;
  const start = forwardOnly ? now : utcDayStart(now);
  const end = addUtcDays(start, days);

  const rows = await db
    .select({
      releasedAt: calendarEvents.releasedAt,
      periodDate: calendarEvents.periodDate,
      periodLabel: calendarEvents.periodLabel,
      eventName: calendarEvents.eventName,
      country: calendarEvents.country,
      currency: calendarEvents.currency,
      actual: calendarEvents.actual,
      forecast: calendarEvents.forecast,
      previous: calendarEvents.previous,
      rawActual: calendarEvents.rawActual,
      rawForecast: calendarEvents.rawForecast,
      rawPrevious: calendarEvents.rawPrevious,
      importance: calendarEvents.importance,
      metricId: calendarEvents.metricId,
      shortName: metrics.shortName,
      unit: metrics.unit,
      region: metrics.region,
      category: metrics.category,
    })
    .from(calendarEvents)
    .leftJoin(metrics, eq(metrics.id, calendarEvents.metricId))
    .where(
      and(
        gte(calendarEvents.releasedAt, start.toISOString()),
        lt(calendarEvents.releasedAt, end.toISOString())
      )
    )
    .orderBy(calendarEvents.releasedAt)
    .limit(800);

  const regionFilter = opts?.region ?? "ALL";
  const kindFilter = opts?.kind ?? "all";

  const filtered = dedupeCalendarRows(rows).filter((r) => {
    const tapeRegion = calendarCountryToRegion(r.country);
    if (regionFilter !== "ALL" && tapeRegion !== regionFilter) return false;

    const eventKind = classifyCalendarEvent(r.eventName);
    if (kindFilter === "data" && eventKind !== "data") return false;
    if (kindFilter === "speakers" && eventKind !== "speaker") return false;
    if (kindFilter === "policy" && eventKind !== "policy") return false;

    if (kindFilter === "all" && eventKind === "auction") return false;
    return true;
  });

  // MacroHub releases are the authoritative released signal for metric events.
  // Calendar-event `actual` values are retained only as a fallback.
  const metricIds = [...new Set(filtered.map((r) => r.metricId).filter(Boolean) as string[])];
  const releaseRows = metricIds.length
    ? await db
        .select({
          metricId: releases.metricId,
          periodDate: releases.periodDate,
          releasedAt: releases.releasedAt,
          value: releases.value,
          expectedValue: releases.expectedValue,
          priorPeriodValue: releases.priorPeriodValue,
        })
        .from(releases)
        .where(inArray(releases.metricId, metricIds))
        .orderBy(desc(releases.releasedAt))
    : [];

  const releaseByMetricPeriod = new Map<string, (typeof releaseRows)[number]>();
  const releaseByMetric = new Map<string, (typeof releaseRows)[number]>();
  for (const release of releaseRows) {
    const key = `${release.metricId}|${release.periodDate}`;
    if (!releaseByMetricPeriod.has(key)) releaseByMetricPeriod.set(key, release);
    if (!releaseByMetric.has(release.metricId)) releaseByMetric.set(release.metricId, release);
  }

  const events = filtered.map((r) => {
    const scale = r.metricId ? investingToCatalogScale(r.metricId) : 1;
    const scaleVal = (v: number | null) =>
      v != null && Number.isFinite(v) ? round(v * scale) : null;
    const eventKind = classifyCalendarEvent(r.eventName);
    const tapeRegion = calendarCountryToRegion(r.country);
    const scheduledRelease = r.metricId && r.periodDate
      ? releaseByMetricPeriod.get(`${r.metricId}|${r.periodDate}`)
      : r.metricId
        ? releaseByMetric.get(r.metricId)
        : undefined;
    const forecast = scaleVal(scheduledRelease?.expectedValue ?? r.forecast);
    const actual = scaleVal(scheduledRelease?.value ?? r.actual);
    const previous = scaleVal(scheduledRelease?.priorPeriodValue ?? r.previous);
    const status = r.metricId ? (scheduledRelease ? "released" : "upcoming") : (actual != null ? "released" : "upcoming");

    return {
      releasedAt: r.releasedAt,
      actualReleasedAt: scheduledRelease?.releasedAt ?? null,
      periodDate: r.periodDate,
      periodLabel: r.periodLabel,
      eventName: r.eventName,
      country: r.country,
      currency: r.currency,
      metricId: r.metricId,
      shortName: r.shortName,
      unit: r.unit,
      region: r.region ?? tapeRegion,
      tapeRegion,
      category: r.category,
      importance: r.importance,
      eventKind,
      speakerInstitution: eventKind === "speaker" ? speakerInstitution(r.eventName) : null,
      actual,
      forecast,
      previous,
      rawActual: r.rawActual,
      rawForecast: r.rawForecast,
      rawPrevious: r.rawPrevious,
      status,
      hasForecast: forecast != null || Boolean(r.rawForecast?.trim()),
    };
  });

  const maxRow = await db
    .select({ maxAt: calendarEvents.releasedAt })
    .from(calendarEvents)
    .orderBy(desc(calendarEvents.releasedAt))
    .limit(1);

  const windowDays = Array.from({ length: days }, (_, i) => {
    const d = addUtcDays(utcDayStart(start), i);
    return d.toISOString().slice(0, 10);
  });

  return {
    events,
    meta: {
      from: start.toISOString(),
      to: end.toISOString(),
      days,
      forwardOnly,
      dataThrough: maxRow[0]?.maxAt ?? null,
      total: events.length,
      withForecast: events.filter((e) => e.hasForecast).length,
      speakers: events.filter((e) => e.eventKind === "speaker").length,
      windowDays,
    },
  };
}

/** @deprecated use getReleaseTape */
export async function getUpcomingCalendar(opts?: { days?: number; region?: string }) {
  const tape = await getReleaseTape({ ...opts, kind: "data", forwardOnly: false });
  return tape.events.filter((e) => e.metricId);
}

export async function getDashboardData(filters?: {
  region?: string;
  category?: string;
}) {
  await ensureSchema();
  const db = getDb();
  const allMetrics = await db.select().from(metrics);

  const filtered = allMetrics.filter((m) => {
    if (filters?.region && filters.region !== "ALL" && m.region !== filters.region) return false;
    if (filters?.category && filters.category !== "ALL" && m.category !== filters.category)
      return false;
    return true;
  });

  const cards = [];
  for (const m of filtered) {
    const latestRows = await db
      .select()
      .from(observations)
      .where(eq(observations.metricId, m.id))
      .orderBy(desc(observations.date))
      .limit(2);

    const latest = latestRows[0];
    const prior = latestRows[1];
    const releaseRows = await db
      .select()
      .from(releases)
      .where(eq(releases.metricId, m.id))
      .orderBy(desc(releases.periodDate))
      .limit(24);
    const displayRelease = pickDisplayRelease(releaseRows, latest?.date ?? null);
    const release = releaseRows[0] ?? null;
    const expectedValue = displayRelease?.expectedValue ?? null;
    const actualValue = latest?.value ?? displayRelease?.value ?? null;
    const surprise = computeSurprise(actualValue, expectedValue, m.unit);

    const live = LIVE_MAP[m.id];

    cards.push({
      id: m.id,
      region: m.region,
      category: m.category,
      subcategory: m.subcategory,
      name: m.name,
      shortName: m.shortName,
      unit: m.unit,
      frequency: m.frequency,
      importance: m.importance,
      officialUrl: m.officialUrl,
      docsUrl: m.docsUrl,
      releaseName: m.releaseName,
      earliestAvailable: m.earliestAvailable,
      observationCount: m.observationCount,
      lastIngestedAt: m.lastIngestedAt,
      liveProvider: live?.provider ?? (m.source === "fred" ? "fred-fallback" : m.source),
      feedNote: release?.notes ?? null,
      latest: latest ? { date: latest.date, value: latest.value } : null,
      prior: prior ? { date: prior.date, value: prior.value } : null,
      delta: latest && prior ? round(latest.value - prior.value) : null,
      release,
      displayReleasedAt: displayRelease?.releasedAt ?? null,
      expectedValue,
      surprise,
      priorPeriodValue: displayRelease?.priorPeriodValue ?? null,
      periodLabel: displayRelease?.periodDate ?? latest?.date ?? null,
    });
  }

  const importanceRank: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    supporting: 3,
  };
  cards.sort(
    (a, b) =>
      (importanceRank[a.importance] ?? 9) - (importanceRank[b.importance] ?? 9) ||
      a.region.localeCompare(b.region) ||
      a.name.localeCompare(b.name)
  );

  const lastRun = (
    await db.select().from(ingestRuns).orderBy(desc(ingestRuns.id)).limit(1)
  )[0];
  const handles = await db.select().from(sourceHandles);

  return { cards, lastRun, handles, totalMetrics: allMetrics.length };
}

export async function getSeriesHistory(metricId: string, limit = 240) {
  const db = getDb();
  const meta = (await db.select().from(metrics).where(eq(metrics.id, metricId)))[0];
  if (!meta) return null;

  const rows = await db
    .select()
    .from(observations)
    .where(eq(observations.metricId, metricId))
    .orderBy(desc(observations.date))
    .limit(limit);

  const history = rows.reverse();
  const releaseRows = await db
    .select()
    .from(releases)
    .where(eq(releases.metricId, metricId))
    .orderBy(desc(releases.releasedAt))
    .limit(48);

  const byPeriod = new Map<string, (typeof releaseRows)[number]>();
  for (const row of releaseRows) {
    const key = row.periodDate;
    const cur = byPeriod.get(key);
    const score = (r: (typeof releaseRows)[number]) =>
      (r.expectedValue != null ? 4 : 0) +
      (r.priorPeriodValue != null ? 2 : 0) +
      (r.priorReleaseValue != null ? 1 : 0);
    if (!cur || score(row) >= score(cur)) byPeriod.set(key, row);
  }
  const releasesDeduped = [...byPeriod.values()].sort((a, b) =>
    b.releasedAt.localeCompare(a.releasedAt)
  ).slice(0, 12);
  const latestPeriod = history[history.length - 1]?.date ?? null;
  const displayRelease = pickDisplayRelease(releasesDeduped, latestPeriod);
  const expectedValue = displayRelease?.expectedValue ?? null;
  const actualValue = latestPeriod
    ? (history[history.length - 1]?.value ?? displayRelease?.value ?? null)
    : null;
  const surprise = computeSurprise(actualValue, expectedValue, meta.unit);

  return {
    meta: {
      ...meta,
      liveProvider: LIVE_MAP[metricId]?.provider ?? meta.source,
    },
    history,
    releases: releasesDeduped,
    displayReleasedAt: displayRelease?.releasedAt ?? null,
    expectedValue,
    surprise,
    priorPeriodValue: displayRelease?.priorPeriodValue ?? null,
    priorPeriodDate: displayRelease?.priorPeriodDate ?? null,
  };
}
export async function getSeriesHistories(
  metricIds: string[],
  limit = 240
) {
  const ids = [...new Set(metricIds)].filter(Boolean);

  if (ids.length === 0) {
    return {};
  }

  const safeLimit = Math.min(Math.max(limit, 24), 2000);
  const db = getDb();
  const client = getClient();

  const metricRows = await db
    .select()
    .from(metrics)
    .where(inArray(metrics.id, ids));

  const metricMap = new Map(metricRows.map((m) => [m.id, m]));

  if (metricRows.length === 0) {
    return {};
  }

  type ObservationRow = {
    id: number;
    metricId: string;
    date: string;
    value: number;
    rawValue: number | null;
    releasedAt: string | null;
    vintageDate: string | null;
      isLatest: boolean | null;
  };

  type ReleaseRow = {
    id: number;
    metricId: string;
    periodDate: string;
    releasedAt: string;
    value: number;
    expectedValue: number | null;
    priorPeriodValue: number | null;
    priorPeriodDate: string | null;
    priorReleaseValue: number | null;
    changeVsPriorPeriod: number | null;
    changeVsPriorRelease: number | null;
    supportingDocUrl: string | null;
    notes: string | null;
  };

  const observationPlaceholders = ids.map(() => "?").join(",");

  const observationResult = await client.execute({
    sql: `
      SELECT
        id,
        metric_id,
        date,
        value,
        raw_value,
        released_at,
        vintage_date,
        is_latest
      FROM (
        SELECT
          id,
          metric_id,
          date,
          value,
          raw_value,
          released_at,
          vintage_date,
          is_latest,
          ROW_NUMBER() OVER (
            PARTITION BY metric_id
            ORDER BY date DESC
          ) AS rn
        FROM observations
        WHERE metric_id IN (${observationPlaceholders})
      )
      WHERE rn <= ?
      ORDER BY metric_id, date DESC
    `,
    args: [...ids, safeLimit],
  });

  const releaseResult = await client.execute({
    sql: `
      SELECT
        id,
        metric_id,
        period_date,
        released_at,
        value,
        expected_value,
        prior_period_value,
        prior_period_date,
        prior_release_value,
        change_vs_prior_period,
        change_vs_prior_release,
        supporting_doc_url,
        notes
      FROM (
        SELECT
          id,
          metric_id,
          period_date,
          released_at,
          value,
          expected_value,
          prior_period_value,
          prior_period_date,
          prior_release_value,
          change_vs_prior_period,
          change_vs_prior_release,
          supporting_doc_url,
          notes,
          ROW_NUMBER() OVER (
            PARTITION BY metric_id
            ORDER BY released_at DESC
          ) AS rn
        FROM releases
        WHERE metric_id IN (${observationPlaceholders})
      )
      WHERE rn <= 48
      ORDER BY metric_id, released_at DESC
    `,
    args: ids,
  });

  const observationsByMetric = new Map<string, ObservationRow[]>();

  for (const row of observationResult.rows) {
    const metricId = String(row.metric_id);

    const parsed: ObservationRow = {
      id: Number(row.id),
      metricId,
      date: String(row.date),
      value: Number(row.value),
      rawValue:
        row.raw_value == null ? null : Number(row.raw_value),
      releasedAt:
        row.released_at == null ? null : String(row.released_at),
      vintageDate:
        row.vintage_date == null ? null : String(row.vintage_date),
      isLatest:
  row.is_latest == null
    ? null
    : Boolean(Number(row.is_latest)),
    };

    const bucket = observationsByMetric.get(metricId) ?? [];
    bucket.push(parsed);
    observationsByMetric.set(metricId, bucket);
  }

  const releasesByMetric = new Map<string, ReleaseRow[]>();

  for (const row of releaseResult.rows) {
    const metricId = String(row.metric_id);

    const parsed: ReleaseRow = {
      id: Number(row.id),
      metricId,
      periodDate: String(row.period_date),
      releasedAt: String(row.released_at),
      value: Number(row.value),
      expectedValue:
        row.expected_value == null
          ? null
          : Number(row.expected_value),
      priorPeriodValue:
        row.prior_period_value == null
          ? null
          : Number(row.prior_period_value),
      priorPeriodDate:
        row.prior_period_date == null
          ? null
          : String(row.prior_period_date),
      priorReleaseValue:
        row.prior_release_value == null
          ? null
          : Number(row.prior_release_value),
      changeVsPriorPeriod:
        row.change_vs_prior_period == null
          ? null
          : Number(row.change_vs_prior_period),
      changeVsPriorRelease:
        row.change_vs_prior_release == null
          ? null
          : Number(row.change_vs_prior_release),
      supportingDocUrl:
        row.supporting_doc_url == null
          ? null
          : String(row.supporting_doc_url),
      notes:
        row.notes == null ? null : String(row.notes),
    };

    const bucket = releasesByMetric.get(metricId) ?? [];
    bucket.push(parsed);
    releasesByMetric.set(metricId, bucket);
  }

  type SeriesHistoryResult = Awaited<
    ReturnType<typeof getSeriesHistory>
  >;

  const result: Record<string, SeriesHistoryResult> = {};

  for (const metricId of ids) {
    const meta = metricMap.get(metricId);

    if (!meta) continue;

    const historyRows =
      observationsByMetric.get(metricId) ?? [];

    const history = [...historyRows].reverse();

    const releaseRows =
      releasesByMetric.get(metricId) ?? [];

    const byPeriod = new Map<string, ReleaseRow>();

    for (const row of releaseRows) {
      const key = row.periodDate;
      const current = byPeriod.get(key);

      const score = (r: ReleaseRow) =>
        (r.expectedValue != null ? 4 : 0) +
        (r.priorPeriodValue != null ? 2 : 0) +
        (r.priorReleaseValue != null ? 1 : 0);

      if (!current || score(row) >= score(current)) {
        byPeriod.set(key, row);
      }
    }

    const releasesDeduped = [...byPeriod.values()]
  .sort((a, b) =>
    b.releasedAt.localeCompare(a.releasedAt)
  )
  .slice(0, 12);

// ---------------------------------------------------------
// Some official series can have a current release available
// before the matching observation has been written/updated.
// Use release rows to fill missing current periods.
// ---------------------------------------------------------
const historyByDate = new Map<
  string,
  { date: string; value: number }
>();

for (const point of history) {
  historyByDate.set(point.date.slice(0, 10), {
    date: point.date.slice(0, 10),
    value: Number(point.value),
  });
}

for (const release of releasesDeduped) {
  const date = release.periodDate.slice(0, 10);

  if (!date) continue;

  // Only fill a missing observation date.
  // Existing observations remain authoritative.
  if (!historyByDate.has(date)) {
    historyByDate.set(date, {
      date,
      value: Number(release.value),
    });
  }
}

const mergedHistory = [...historyByDate.values()]
  .filter((point) =>
    Number.isFinite(point.value)
  )
  .sort((a, b) =>
    a.date.localeCompare(b.date)
  );

const latestPeriod =
  mergedHistory[
    mergedHistory.length - 1
  ]?.date ?? null;

    const displayRelease = pickDisplayRelease(
      releasesDeduped,
      latestPeriod
    );

    const expectedValue =
      displayRelease?.expectedValue ?? null;

    const actualValue = latestPeriod
  ? (
      mergedHistory[
        mergedHistory.length - 1
      ]?.value ??
      displayRelease?.value ??
      null
    )
  : null;

    const surprise = computeSurprise(
      actualValue,
      expectedValue,
      meta.unit
    );

    result[metricId] = {
      meta: {
        ...meta,
        liveProvider:
          LIVE_MAP[metricId]?.provider ?? meta.source,
      },
      history,
      releases: releasesDeduped,
      displayReleasedAt:
        displayRelease?.releasedAt ?? null,
      expectedValue,
      surprise,
      priorPeriodValue:
        displayRelease?.priorPeriodValue ?? null,
      priorPeriodDate:
        displayRelease?.priorPeriodDate ?? null,
    };
  }

  return result;
}
function buildMatrixColumns(months: number): string[] {
  const now = new Date();
  const cols: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    cols.push(`${y}-${m}-01`);
  }
  return cols;
}

function resolveColumnRule(
  row: { columnRule?: ColumnRule; columnRuleByRegion?: Partial<Record<DeskRegion, ColumnRule>>; surveyMonths?: number[] },
  region: DeskRegion
): { rule: ColumnRule; surveyMonths?: number[] } {
  const rule = row.columnRuleByRegion?.[region] ?? row.columnRule ?? "monthly";
  return { rule, surveyMonths: row.surveyMonths };
}

export async function getDeskMatrixData(opts?: { months?: number }) {
  await ensureSchema();
  const db = getDb();
  const months = opts?.months ?? 12;
  const columns = buildMatrixColumns(months);
  const start = columns[0];
  const metricIds = allDeskMatrixMetricIds();
  const metricMap = new Map(METRICS.filter((m) => metricIds.includes(m.id)).map((m) => [m.id, m]));

  const obsRows = await db
    .select({
      metricId: observations.metricId,
      date: observations.date,
      value: observations.value,
    })
    .from(observations)
    .where(and(inArray(observations.metricId, metricIds), gte(observations.date, start)));

  const releaseRows = await db
    .select({
      metricId: releases.metricId,
      periodDate: releases.periodDate,
      expectedValue: releases.expectedValue,
    })
    .from(releases)
    .where(
      and(inArray(releases.metricId, metricIds), gte(releases.periodDate, start))
    );

  const actualByMetric = new Map<string, Map<string, number>>();
  for (const row of obsRows) {
    const meta = metricMap.get(row.metricId);
    if (!actualByMetric.has(row.metricId)) actualByMetric.set(row.metricId, new Map());
    const bucket = actualByMetric.get(row.metricId)!;
    bucket.set(row.date, row.value);
    if (meta?.frequency === "quarterly") {
      bucket.set(toQuarterEndPeriod(row.date), row.value);
    }
  }

  const expectedByMetric = new Map<string, Map<string, number>>();
  for (const row of releaseRows) {
    if (row.expectedValue == null) continue;
    const meta = metricMap.get(row.metricId);
    if (!expectedByMetric.has(row.metricId)) expectedByMetric.set(row.metricId, new Map());
    const bucket = expectedByMetric.get(row.metricId)!;
    bucket.set(row.periodDate, row.expectedValue);
    if (meta?.frequency === "quarterly") {
      bucket.set(toQuarterEndPeriod(row.periodDate), row.expectedValue);
    }
  }

  const blocks = DESK_MATRIX_BLOCKS.map((block) => ({
    id: block.id,
    title: block.title,
    subblocks: block.subblocks.map((sub) => ({
      id: sub.id,
      title: sub.title,
      rows: sub.rows.flatMap((rowDef) => {
        const regions: DeskRegion[] = rowDef.onlyRegion
          ? [rowDef.onlyRegion]
          : ["US", "UK", "EA"];
        return regions.map((region) => {
          const metricId = rowDef[region.toLowerCase() as "us" | "uk" | "ea"];
          const meta = metricMap.get(metricId);
          const { rule, surveyMonths } = resolveColumnRule(rowDef, region);
          const actuals = actualByMetric.get(metricId) ?? new Map();
          const expected = expectedByMetric.get(metricId) ?? new Map();
          const unit = meta?.unit ?? "number";

          const cells = columns.map((period) => {
            if (!cellAllowed(period, rule, surveyMonths)) {
              return { period, actual: null, expected: null };
            }
            const lookup =
              rule === "quarter" ? toQuarterEndPeriod(period) : period;
            const actual = actuals.get(lookup) ?? null;
            const exp = expected.get(lookup) ?? null;
            return { period, actual, expected: exp };
          });

          return {
            rowId: rowDef.id,
            rowLabel: rowDef.label,
            region,
            metricId,
            shortName: meta?.shortName ?? metricId,
            unit,
            cells,
          };
        });
      }),
    })),
  }));

  return {
    columns,
    blocks,
    meta: { months, metricCount: metricIds.length },
  };
}

function lookbackStart(period: string, extraMonths: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - extraMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function stepMonthsForPeriodsPerYear(periodsPerYear: number): number {
  return periodsPerYear === 4 ? 3 : 1;
}

function computeSmoothedValue(
  method: SmoothMethod,
  seriesMap: Map<string, SeriesPoint>,
  anchorPeriod: string,
  periodsPerYear = 12
): number | null {
  const step = stepMonthsForPeriodsPerYear(periodsPerYear);

  if (method === "ma3") {
    const win = windowEndingAt(seriesMap, anchorPeriod, 3, step);
    if (!win) return null;
    const avg = movingAverage3(win.map((p) => p.value));
    return avg == null ? null : roundSmooth(avg);
  }
  if (method === "ann3m_mom") {
    const win = windowEndingAt(seriesMap, anchorPeriod, 3, step);
    if (!win) return null;
    const ann = annualized3mFromMom(win.map((p) => p.value), { periodsPerYear });
    return ann == null ? null : roundSmooth(ann);
  }
  if (method === "ann3m_index") {
    const win = windowEndingAt(seriesMap, anchorPeriod, 4, step);
    if (!win) return null;
    const ann = annualized3mFromIndex(win.map(indexLevel));
    return ann == null ? null : roundSmooth(ann);
  }
  return null;
}

export async function getDeskSmoothedData(opts?: { months?: number }) {
  await ensureSchema();
  const db = getDb();
  const months = opts?.months ?? 12;
  const columns = buildMatrixColumns(months);
  const start = columns[0]!;
  const lookback = lookbackStart(start, 8);
  const metricIds = allDeskSmoothedMetricIds();
  const metricMap = new Map(METRICS.filter((m) => metricIds.includes(m.id)).map((m) => [m.id, m]));

  const obsRows = await db
    .select({
      metricId: observations.metricId,
      date: observations.date,
      value: observations.value,
      rawValue: observations.rawValue,
    })
    .from(observations)
    .where(and(inArray(observations.metricId, metricIds), gte(observations.date, lookback)));

  const seriesMapsByMetric = new Map<string, Map<string, SeriesPoint>>();
  for (const row of obsRows) {
    const meta = metricMap.get(row.metricId);
    const point: SeriesPoint = {
      date: row.date,
      value: row.value,
      rawValue: row.rawValue,
    };

    if (!seriesMapsByMetric.has(row.metricId)) seriesMapsByMetric.set(row.metricId, new Map());
    const map = seriesMapsByMetric.get(row.metricId)!;
    map.set(row.date, point);
    if (meta?.frequency === "quarterly") {
      map.set(toQuarterEndPeriod(row.date), point);
    }
  }

  const blocks = DESK_SMOOTHED_ROWS.map((rowDef) => {
    const regions: DeskRegion[] = ["US", "UK", "EA"];
    const method = rowDef.method;
    const rows = regions.map((region) => {
      const metricId = rowDef[region.toLowerCase() as "us" | "uk" | "ea"];
      const meta = metricMap.get(metricId);
      const { rule } = resolveColumnRule(rowDef, region);
      const rowMethod = rowDef.methodByRegion?.[region] ?? method;
      const periodsPerYear = rowDef.periodsPerYearByRegion?.[region] ?? 12;
      const seriesMap = seriesMapsByMetric.get(metricId) ?? new Map();

      const cells = columns.map((period) => {
        if (!cellAllowed(period, rule)) {
          return { period, value: null };
        }
        const lookup = rule === "quarter" ? toQuarterEndPeriod(period) : period;
        const value = computeSmoothedValue(rowMethod, seriesMap, lookup, periodsPerYear);
        return { period, value };
      });

      return {
        rowId: rowDef.id,
        rowLabel: rowDef.label,
        method: rowMethod,
        methodLabel: SMOOTH_METHOD_SHORT[rowMethod],
        region,
        metricId,
        shortName: meta?.shortName ?? metricId,
        unit: meta?.unit ?? "percent",
        cells,
      };
    });

    return {
      id: rowDef.id,
      title: rowDef.label,
      method,
      methodLabel: SMOOTH_METHOD_SHORT[method],
      note: rowDef.note ?? null,
      rows,
    };
  });

  const rows = blocks.flatMap((b) => b.rows);

  return {
    columns,
    blocks,
    rows,
    methods: SMOOTH_METHOD_LABELS,
    meta: { months, metricCount: metricIds.length },
  };
}
