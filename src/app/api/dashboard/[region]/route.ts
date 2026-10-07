import { NextRequest, NextResponse } from "next/server";

import {
  DASHBOARD,
  type Region,
  type UiNode,
} from "@/components/macro-ui-hierarchy";
import { getSeriesHistories } from "@/data/dashboard";
import { METRICS } from "@/catalog/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function allLeafMetricIds(nodes: UiNode[] = []) {
  const ids: string[] = [];

  const walk = (xs: UiNode[]) => {
    xs.forEach((node) => {
      if (node.metricId) ids.push(node.metricId);
      if (node.children) walk(node.children);
    });
  };

  walk(nodes);

  return [...new Set(ids)];
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ region: string }> }
) {
  try {
    const { region } = await ctx.params;
    const r = region.toUpperCase() as Region;

    const specsByCategory = DASHBOARD[r];

    if (!specsByCategory) {
      return NextResponse.json(
        { error: "Unknown region" },
        { status: 404 }
      );
    }

    const allSpecs = Object.values(specsByCategory).flat();

    const rootIds = allSpecs.flatMap((spec) => [
      spec.metricId,
      ...(spec.yoyMetricId ? [spec.yoyMetricId] : []),
      ...(spec.momMetricId ? [spec.momMetricId] : []),
    ]);

    const componentIds = allSpecs.flatMap((spec) =>
      allLeafMetricIds(spec.components)
    );

    const chartIds = allSpecs.flatMap((spec) =>
      spec.chartMetricIds ?? []
    );

    const continuousIds = METRICS
      .filter((metric) => metric.region === r && (metric.frequency === "daily" || metric.frequency === "hourly"))
      .map((metric) => metric.id);
    const ids = [...new Set([...rootIds, ...componentIds, ...chartIds, ...continuousIds])];

    const result = await getSeriesHistories(ids, 60);
    const hourlyIds = METRICS
      .filter((metric) => metric.region === r && metric.frequency === "hourly")
      .map((metric) => metric.id);
    if (hourlyIds.length) Object.assign(result, await getSeriesHistories(hourlyIds, 800));

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);

    return NextResponse.json(
      { error: "Unable to load dashboard data." },
      { status: 500 }
    );
  }
}
