import { NextRequest, NextResponse } from "next/server";
import { getSeriesHistory } from "@/data/dashboard";
import { METRICS } from "@/catalog/metrics";
import { buildThreeMonthMethodMap, buildThreeMonthTrend } from "@/lib/three-month-trend";

const THREE_MONTH_METHODS = buildThreeMonthMethodMap(METRICS);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "240");
  const historyLimit = Math.min(Math.max(limit, 24), 5000);
  const data = await getSeriesHistory(id, historyLimit);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const metric = METRICS.find((candidate) => candidate.id === id);
  if (metric?.region === "US" || metric?.region === "UK") {
    const method = THREE_MONTH_METHODS.get(metric.id);
    const companionId = method?.sourceMetricIds.find((sourceId) => sourceId !== metric.id);
    let momHistory: Array<{ date: string; value: number }> | undefined;
    if (companionId) {
      const momData = await getSeriesHistory(companionId, historyLimit);
      momHistory = momData?.history;
    }
    const threeMonth = method ? buildThreeMonthTrend(metric, data.history, method, momHistory) : null;
    if (threeMonth?.history.length) Object.assign(data, { threeMonth });
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

