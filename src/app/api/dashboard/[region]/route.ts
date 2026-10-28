import { NextRequest, NextResponse } from "next/server";

import {
  DASHBOARD,
  flattenMetricIds,
  type Region,
} from "@/components/macro-ui-hierarchy";
import { getSeriesHistories } from "@/data/dashboard";
import { METRICS } from "@/catalog/metrics";
import { contributionMetricIds } from "@/lib/inflation-contributions";
import { buildThreeMonthMethodMap, buildThreeMonthTrend } from "@/lib/three-month-trend";
import { compactDashboardPayload } from "@/lib/dashboard-payload";

const THREE_MONTH_METHODS = buildThreeMonthMethodMap(METRICS);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      flattenMetricIds(spec.components)
    );

    const chartIds = allSpecs.flatMap((spec) =>
      spec.chartMetricIds ?? []
    );

    // CPI YoY must use NSA indexes when a published rate series is missing.
    // The headline and core CPI charts/cards derive rates from these source
    // series so an empty standalone rate metric does not erase the display.
    const inflationRateFallbackIds = r === "US"
      ? ["us-cpi-nsa", "us-cpi-core-nsa"]
      : [];
    const underlyingInflationIds = r === "US"
      ? [
          "us-sticky-cpi", "us-sticky-cpi-mom",
          "us-core-sticky-cpi", "us-core-sticky-cpi-mom",
          "us-cleveland-median-pce", "us-cleveland-median-pce-mom",
          "us-dallas-trimmed-mean-pce", "us-dallas-trimmed-mean-pce-mom",
          "us-cleveland-median-cpi", "us-cleveland-median-cpi-mom",
          "us-cleveland-trimmed-cpi", "us-cleveland-trimmed-cpi-mom",
        ]
      : [];

    const continuousIds = METRICS
      .filter((metric) => metric.region === r && (metric.frequency === "daily" || metric.frequency === "hourly"))
      .map((metric) => metric.id);
    const driverIds = contributionMetricIds().filter(id => METRICS.some(metric => metric.id === id && metric.region === r));
    const threeMonthSourceIds = [...rootIds, ...componentIds, ...chartIds]
      .flatMap((id) => THREE_MONTH_METHODS.get(id)?.sourceMetricIds ?? []);
    const ids = [...new Set([...rootIds, ...componentIds, ...chartIds, ...inflationRateFallbackIds, ...underlyingInflationIds, ...continuousIds, ...driverIds, ...threeMonthSourceIds])];

    // Include the prior year so 2026 charts can calculate YoY values from
    // the underlying published levels while the visible chart stays scoped
    // to the current year in the client.
    const result = await getSeriesHistories(ids, 240);
    if (r === "US" || r === "UK" || r === "EA") {
      for (const metricId of ids) {
        const metric = METRICS.find((candidate) => candidate.id === metricId && candidate.region === r);
        const method = THREE_MONTH_METHODS.get(metricId);
        const sourceHistory = result[metricId]?.history;
        if (!metric || !method || !sourceHistory?.length) continue;
        const companionId = method.sourceMetricIds.find((sourceId) => sourceId !== metricId);
        const companionHistory = companionId ? result[companionId]?.history : undefined;
        const threeMonth = buildThreeMonthTrend(metric, sourceHistory, method, companionHistory);
        if (threeMonth?.history.length && result[metricId]) {
          Object.assign(result[metricId], { threeMonth });
        }
      }
    }
    const hourlyIds = METRICS
      .filter((metric) => metric.region === r && metric.frequency === "hourly")
      .map((metric) => metric.id);
    if (hourlyIds.length) Object.assign(result, await getSeriesHistories(hourlyIds, 800));

    return NextResponse.json(compactDashboardPayload(result), {
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
