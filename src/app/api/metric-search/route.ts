import { NextResponse } from "next/server";
import { METRICS } from "@/catalog/metrics";
import { DASHBOARD, type Region, type UiNode } from "@/components/macro-ui-hierarchy";

export const dynamic = "force-dynamic";

export async function GET() {
  const byId = new Map(METRICS.map(metric => [metric.id, metric]));
  const entries = new Map<string, { id: string; region: Region; category: string; label: string; searchText: string }>();
  const add = (id: string | undefined, region: Region, category: string, fallbackLabel: string) => {
    if (!id) return;
    const metric = byId.get(id);
    const label = metric?.shortName ?? metric?.name ?? fallbackLabel;
    entries.set(region + ":" + id, {
      id, region, category, label,
      searchText: [label, metric?.name, fallbackLabel, region, category].filter(Boolean).join(" ").toLowerCase(),
    });
  };
  for (const region of ["US", "UK", "EA"] as Region[]) {
    for (const [category, specs] of Object.entries(DASHBOARD[region])) {
      for (const spec of specs) {
        add(spec.metricId, region, category, spec.title ?? spec.id);
        add(spec.yoyMetricId, region, category, spec.title ? spec.title + " YoY" : spec.id + " YoY");
        add(spec.momMetricId, region, category, spec.title ? spec.title + " MoM" : spec.id + " MoM");
        for (const chartId of spec.chartMetricIds ?? []) add(chartId, region, category, spec.title ?? spec.id);
        const visit = (nodes: UiNode[] = []) => nodes.forEach(node => {
          add(node.metricId, region, category, node.label);
          add(node.momMetricId, region, category, node.label + " MoM");
          visit(node.children);
        });
        visit(spec.components);
      }
    }
  }
  return NextResponse.json([...entries.values()], { headers: { "Cache-Control": "public, max-age=300" } });
}
