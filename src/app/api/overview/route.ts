import { NextResponse } from "next/server";
import { getSeriesHistories } from "@/data/dashboard";
import { overviewMetricIds } from "@/lib/overview-data";
import { expectationsOverviewMetricIds } from "@/lib/expectations-overview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const overviewIds = overviewMetricIds();
    const [histories, expectationHistories] = await Promise.all([
      // Overview charts need the prior-year base for YoY calculations and
      // enough history for the year-range slider, not just the latest 5 years.
      getSeriesHistories(overviewIds, 240),
      getSeriesHistories(expectationsOverviewMetricIds(), 300),
    ]);
    return NextResponse.json({ ...histories, ...expectationHistories }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Overview API error:", error);
    return NextResponse.json({ error: "Unable to load the economic overview." }, { status: 500 });
  }
}
