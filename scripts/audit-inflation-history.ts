import { getClient } from "@/db";
import { METRICS } from "@/catalog/metrics";
import { buildThreeMonthMethodMap } from "@/lib/three-month-trend";

const isInflationPrice = (id: string, region: string) => {
  if (region === "US") return /^(us-(cpi|core-cpi|services-cpi|pce|core-pce|ppi|sticky-cpi|flexible-cpi|import-prices|cleveland-(median|trimmed)-cpi))/.test(id);
  if (region === "UK") return /^(uk-(cpi|cpih|core-cpi|core-cpih|rpi|[a-z-]+-cpi(h)?|ppi))/.test(id);
  if (region === "EA") return /^(ea-(hicp|core-hicp|services-hicp|goods-hicp|food-hicp|energy-hicp|ppi))/.test(id);
  return false;
};

async function main() {
  const catalog = METRICS.filter((metric) => isInflationPrice(metric.id, metric.region));
  const ids = catalog.map((metric) => metric.id);
  const placeholders = ids.map(() => "?").join(",");
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT m.id, m.region, m.source, m.series_id, m.transform,
                 COUNT(o.id) AS observations, MIN(o.date) AS first_date, MAX(o.date) AS latest_date,
                 (SELECT o2.value FROM observations o2 WHERE o2.metric_id=m.id ORDER BY o2.date DESC LIMIT 1) AS latest_value
          FROM metrics m LEFT JOIN observations o ON o.metric_id = m.id
          WHERE m.id IN (${placeholders}) GROUP BY m.id ORDER BY m.region, m.id`,
    args: ids,
  });
  const byRegion = new Map<string, { count: number; observations: number; first: string; latest: string; gaps: string[] }>();
  const keyRows = new Set([
    "us-cpi-yoy", "us-cpi-mom", "us-core-cpi-yoy", "us-core-cpi-mom", "us-pce", "us-core-pce",
    "uk-cpi-yoy", "uk-cpi-mom", "uk-cpih-yoy", "uk-rpi-yoy", "uk-ppi-output-yoy", "uk-ppi-input-yoy",
    "ea-hicp-yoy", "ea-hicp-mom", "ea-core-hicp-yoy", "ea-ppi-yoy", "ea-ppi-mom",
  ]);
  for (const row of result.rows) {
    const region = String(row.region);
    const entry = byRegion.get(region) ?? { count: 0, observations: 0, first: "9999", latest: "", gaps: [] };
    entry.count++;
    entry.observations += Number(row.observations);
    entry.first = String(row.first_date ?? "").localeCompare(entry.first) < 0 ? String(row.first_date) : entry.first;
    entry.latest = String(row.latest_date ?? "").localeCompare(entry.latest) > 0 ? String(row.latest_date) : entry.latest;
    const id = String(row.id);
    const expected = region === "EA" ? (id.startsWith("ea-ppi-") ? "2026-08" : "2026-09")
      : region === "US" && (id.startsWith("us-pce") || id.startsWith("us-core-pce")) ? "2026-08" : "2026-09";
    if (!row.latest_date || String(row.latest_date).slice(0, 7) < expected) entry.gaps.push(`${id}:${row.latest_date ?? "none"}`);
    byRegion.set(region, entry);
    if (keyRows.has(id)) console.log(`CHECK|${Object.values(row).join("|")}`);
  }
  for (const [region, summary] of byRegion) console.log(`SUMMARY|${region}|metrics=${summary.count}|observations=${summary.observations}|coverage=${summary.first}..${summary.latest}|latest_gaps=${summary.gaps.join(",") || "none"}`);
  const beaLevels = await client.execute({
    sql: "SELECT metric_id, date, value FROM observations WHERE metric_id IN ('us-pce','us-core-pce') ORDER BY metric_id, date DESC",
  });
  const levels = new Map<string, number[]>();
  const dates = new Map<string, string[]>();
  for (const row of beaLevels.rows) {
    const id = String(row.metric_id);
    levels.set(id, [...(levels.get(id) ?? []), Number(row.value)]);
    dates.set(id, [...(dates.get(id) ?? []), String(row.date)]);
  }
  for (const [id, values] of levels) {
    if (values.length < 13) continue;
    const yoy = (values[0] / values[12] - 1) * 100;
    const mom = (values[0] / values[1] - 1) * 100;
    console.log(`DERIVED|${id}|${dates.get(id)?.[0]}|YoY=${yoy.toFixed(4)}|MoM=${mom.toFixed(4)}`);
  }
  const threeMonthMethods = buildThreeMonthMethodMap(METRICS);
  for (const id of ["us-cpi-yoy", "us-core-cpi-yoy", "us-pce", "us-core-pce", "us-ppi-final-demand", "us-ppi-core", "uk-cpi-yoy", "uk-rpi-yoy", "uk-ppi-output-yoy", "ea-hicp-yoy", "ea-ppi-yoy"]) {
    const method = threeMonthMethods.get(id);
    console.log(`TREND|${id}|${method?.method ?? "missing"}|${method?.label ?? ""}|${method?.sourceMetricIds.join(",") ?? ""}`);
  }
}

void main();
