import { METRICS } from "@/catalog/metrics";
import {
  DESK_MATRIX_BLOCKS,
  allDeskMatrixMetricIds,
  cellAllowed,
  type ColumnRule,
  type DeskRegion,
  toQuarterEndPeriod,
} from "@/catalog/desk-matrix";
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
  sql,
  lt,
} from "drizzle-orm";
import { LIVE_MAP } from "@/catalog/live-map";
import { executeRead, getD1Database, getDb } from "@/db";
import { getActiveLiveSource } from "@/ingest/source-registry";
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
  releaseTapeWindow,
} from "@/lib/calendar-tape";
import { round } from "@/ingest/transforms";`r`
import { investingToCatalogScale } from "@/catalog/investing-map";

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
  pastOnly?: boolean;
}) {
  const db = getDb();
  const days = opts?.days ?? 7;
  const now = new Date();
  const forwardOnly = opts?.forwardOnly !== false;
  const { start, end } = releaseTapeWindow(now, days, { forwardOnly, pastOnly: opts?.pastOnly });

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
  const db = getDb();
  const isCloud = Boolean(getD1Database());
  const allMetrics = await db.select().from(metrics);

  const filtered = allMetrics.filter((m) => {
    if (filters?.region && filters.region !== "ALL" && m.region !== filters.region) return false;
    if (filters?.category && filters.category !== "ALL" && m.category !== filters.category)
      return false;
    return true;
  });

  const cards = [];
  // Fetch the latest records in two queries instead of two queries per metric.
  // The free D1 tier limits database queries per Worker invocation.
  const recentObservations = await db.select().from(observations).where(sql`${observations.id} IN (
    SELECT recent.id FROM metrics catalog JOIN observations recent
      ON recent.id IN (SELECT id FROM observations WHERE metric_id = catalog.id ORDER BY date DESC, id DESC LIMIT 2)
  )`).orderBy(desc(observations.date));
  const recentReleases = await db.select().from(releases).where(sql`${releases.id} IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY metric_id ORDER BY period_date DESC) AS rn
      FROM releases
    ) WHERE rn <= 24
  )`).orderBy(desc(releases.periodDate));
  for (const m of filtered) {
    const latestRows = recentObservations.filter(row => row.metricId === m.id);

    const latest = latestRows[0];
    const prior = latestRows[1];
    const releaseRows = recentReleases.filter(row => row.metricId === m.id);
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
      liveSource: getActiveLiveSource(m.id, isCloud),
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
  const isCloud = Boolean(getD1Database());
  const meta = (await db.select().from(metrics).where(eq(metrics.id, metricId)))[0];
  if (!meta) return null;

  const rows = await db
    .select()
    .from(observations)
    .where(eq(observations.metricId, metricId))
    .orderBy(desc(observations.date), desc(observations.id))
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
      liveSource: getActiveLiveSource(metricId, isCloud),
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
): Promise<Record<string, Awaited<ReturnType<typeof getSeriesHistory>>>> {
  const ids = [...new Set(metricIds)].filter(Boolean);

  if (ids.length === 0) {
    return {};
  }

  // D1 permits at most 100 bound parameters; leave room for LIMIT arguments.
  if (ids.length > 80) {
    const combined: Record<string, Awaited<ReturnType<typeof getSeriesHistory>>> = {};
    for (let offset = 0; offset < ids.length; offset += 80) {
      Object.assign(combined, await getSeriesHistories(ids.slice(offset, offset + 80), limit));
    }
    return combined;
  }

  const safeLimit = Math.min(Math.max(limit, 24), 2000);
  const db = getDb();
  const isCloud = Boolean(getD1Database());

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

  const observationResult = await executeRead({
    sql: `SELECT * FROM (${ids.map(() => `SELECT * FROM (SELECT * FROM observations WHERE metric_id = ? ORDER BY date DESC, id DESC LIMIT ${Math.trunc(safeLimit)})`).join(" UNION ALL ")}) ORDER BY metric_id, date DESC, id DESC`,
    args: ids,
  });

  const releaseResult = await executeRead({
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
        liveSource: getActiveLiveSource(metricId, isCloud),
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




