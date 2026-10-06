import { allDeskMatrixMetricIds } from "@/catalog/desk-matrix";
import { allDeskSmoothedMetricIds } from "@/catalog/desk-smoothed";
import { METRICS } from "@/catalog/metrics";
import { getDb } from "@/db";
import { observations } from "@/db/schema";
import { inArray, desc, eq, and, sql } from "drizzle-orm";

const JUL = "2026-07-01";
const AUG = "2026-08-01";

const QUARTERLY_IDS = new Set([
  "us-gdp-real",
  "uk-gdp-qoq",
  "ea-gdp-qoq",
  "ea-employment-change",
  "ea-wage-growth",
  "ea-wage-growth-qoq",
  "ea-safe-wage-exp-1y",
]);

const SURVEY_IDS = new Set([
  "uk-inflation-exp-1y",
  "uk-inflation-exp-5y",
  "ea-inflation-exp-1y",
  "ea-core-inflation-exp-1y",
  "ea-inflation-exp-lt",
]);

export type FreshnessStatus = "ok" | "lag" | "survey" | "quarterly" | "missing";

export interface FreshnessRow {
  metricId: string;
  shortName: string;
  region: string;
  frequency: string;
  latestDate: string | null;
  latestValue: number | null;
  jul2026: number | null;
  aug2026: number | null;
  status: FreshnessStatus;
  note: string | null;
}

export interface DataFreshnessReport {
  checkedAt: string;
  targetMonths: { jul: string; aug: string };
  summary: {
    total: number;
    julPresent: number;
    augPresent: number;
    lagging: number;
  };
  rows: FreshnessRow[];
}

function classifyStatus(
  metricId: string,
  frequency: string,
  latestDate: string | null,
  jul2026: number | null
): { status: FreshnessStatus; note: string | null } {
  if (QUARTERLY_IDS.has(metricId) || frequency === "quarterly") {
    return {
      status: "quarterly",
      note: "Quarterly series — Jul is not a reference month",
    };
  }
  if (SURVEY_IDS.has(metricId)) {
    return {
      status: "survey",
      note: "Survey series — published Feb/May/Aug/Nov (EA SPF/LT) or quarterly (SAFE)",
    };
  }
  if (metricId.startsWith("uk-dmp-")) {
    if (latestDate && latestDate >= AUG) {
      return { status: "ok", note: "BoE DMP — monthly, Aug release ingested" };
    }
    return { status: jul2026 != null ? "ok" : "lag", note: "BoE DMP — monthly" };
  }
  if (!latestDate) {
    return { status: "missing", note: "No observations in database" };
  }
  if (latestDate >= JUL) {
    return { status: "ok", note: null };
  }
  if (latestDate >= "2026-06-01") {
    return {
      status: "lag",
      note: `Official lag — latest print is ${latestDate.slice(0, 7)}`,
    };
  }
  return {
    status: "lag",
    note: `Stale — latest print is ${latestDate.slice(0, 7)}`,
  };
}

export async function getDataFreshness(): Promise<DataFreshnessReport> {
  const metricIds = [
    ...new Set([...allDeskMatrixMetricIds(), ...allDeskSmoothedMetricIds()]),
  ].sort();
  const meta = new Map(METRICS.filter((m) => metricIds.includes(m.id)).map((m) => [m.id, m]));

  const db = getDb();
  const latestRows = await db
    .select({
      metricId: observations.metricId,
      date: observations.date,
      value: observations.value,
    })
    .from(observations)
    .where(sql`${observations.id} IN (
      SELECT recent.id FROM metrics catalog JOIN observations recent
      ON recent.id = (SELECT id FROM observations WHERE metric_id = catalog.id ORDER BY date DESC, id DESC LIMIT 1)
    )`)
    .orderBy(desc(observations.date));

  const latestByMetric = new Map<string, { date: string; value: number }>();
  for (const row of latestRows) {
    if (!latestByMetric.has(row.metricId)) {
      latestByMetric.set(row.metricId, { date: row.date, value: row.value });
    }
  }

  const julRows = await db
    .select({
      metricId: observations.metricId,
      value: observations.value,
    })
    .from(observations)
    .where(and(inArray(observations.metricId, metricIds), eq(observations.date, JUL)));

  const augRows = await db
    .select({
      metricId: observations.metricId,
      value: observations.value,
    })
    .from(observations)
    .where(and(inArray(observations.metricId, metricIds), eq(observations.date, AUG)));

  const julMap = new Map(julRows.map((r) => [r.metricId, r.value]));
  const augMap = new Map(augRows.map((r) => [r.metricId, r.value]));

  const rows: FreshnessRow[] = metricIds.map((metricId) => {
    const m = meta.get(metricId);
    const latest = latestByMetric.get(metricId);
    const jul2026 = julMap.get(metricId) ?? null;
    const aug2026 = augMap.get(metricId) ?? null;
    const { status, note } = classifyStatus(
      metricId,
      m?.frequency ?? "monthly",
      latest?.date ?? null,
      jul2026
    );
    return {
      metricId,
      shortName: m?.shortName ?? metricId,
      region: m?.region ?? "?",
      frequency: m?.frequency ?? "monthly",
      latestDate: latest?.date ?? null,
      latestValue: latest?.value ?? null,
      jul2026,
      aug2026,
      status,
      note,
    };
  });

  const julPresent = rows.filter((r) => r.jul2026 != null).length;
  const augPresent = rows.filter((r) => r.aug2026 != null).length;
  const lagging = rows.filter((r) => r.status === "lag" || r.status === "missing").length;

  return {
    checkedAt: new Date().toISOString(),
    targetMonths: { jul: JUL, aug: AUG },
    summary: {
      total: rows.length,
      julPresent,
      augPresent,
      lagging,
    },
    rows,
  };
}
