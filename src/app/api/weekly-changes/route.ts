import { NextResponse } from "next/server";
import { METRICS } from "@/catalog/metrics";
import { DASHBOARD, type Region } from "@/components/macro-ui-hierarchy";
import { getSeriesHistories } from "@/data/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Use only top-level dashboard indicators and their explicit YoY/MoM series.
  // Nested component nodes are deliberately excluded.
  const topLevelIds = new Set<string>();
  for (const region of ["US", "UK", "EA"] as Region[]) {
    for (const spec of Object.values(DASHBOARD[region]).flat()) {
      const hasRateSeries = Boolean(spec.yoyMetricId || spec.momMetricId);
      if (spec.metricId && (!hasRateSeries || METRICS.find(item => item.id === spec.metricId)?.transform !== "level")) topLevelIds.add(spec.metricId);
      if (spec.yoyMetricId) topLevelIds.add(spec.yoyMetricId);
      if (spec.momMetricId) topLevelIds.add(spec.momMetricId);
    }
  }
  const metrics = METRICS.filter(metric => topLevelIds.has(metric.id) && !["daily", "hourly"].includes(metric.frequency));
  const histories = await getSeriesHistories(metrics.map(metric => metric.id), 36);
  const rows = metrics.flatMap(metric => {
    const data = histories[metric.id];
    const history = data?.history ?? [];
    const current = history.at(-1);
    const previous = history.at(-2);
    if (!current || !previous || current.value === previous.value) return [];
    return [{
      id: metric.id, region: metric.region, category: metric.category,
      name: metric.name, shortName: metric.shortName, unit: metric.unit,
      frequency: metric.frequency, importance: metric.importance, transform: metric.transform,
      source: data?.meta?.liveSource ?? metric.source,
      current, previous, change: current.value - previous.value,
      expectedValue: data?.expectedValue ?? null,
      releasedAt: data?.displayReleasedAt ?? null,
    }];
  });
  const byId = new Map(rows.map(row => [row.id, row]));
  const pairs: { region: Region; label: string; yoy: typeof rows[number] | null; mom: typeof rows[number] | null }[] = [];
  const addPair = (region: Region, label: string, yoyId: string, momId: string) => {
    const yoy = byId.get(yoyId) ?? null;
    const mom = byId.get(momId) ?? null;
    if (yoy || mom) pairs.push({ region, label, yoy, mom });
  };
  addPair("US", "CPI", "us-cpi-yoy", "us-cpi-mom");
  addPair("US", "Core CPI", "us-core-cpi-yoy", "us-core-cpi-mom");
  addPair("US", "PCE", "us-pce-yoy", "us-pce-mom");
  addPair("US", "Core PCE", "us-core-pce-yoy", "us-core-pce-mom");
  addPair("UK", "CPI", "uk-cpi-yoy", "uk-cpi-mom");
  addPair("UK", "Core CPI", "uk-core-cpi-yoy", "uk-core-cpi-mom");
  addPair("UK", "CPIH", "uk-cpih-yoy", "uk-cpih-mom");
  addPair("EA", "HICP", "ea-hicp-yoy", "ea-hicp-mom");
  addPair("EA", "Core HICP", "ea-core-hicp-yoy", "ea-core-hicp-mom");
  return NextResponse.json({ rows, ratePairs: pairs }, { headers: { "Cache-Control": "no-store" } });
}
