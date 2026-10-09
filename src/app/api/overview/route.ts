import { NextResponse } from "next/server";
import { getSeriesHistories } from "@/data/dashboard";
import { OVERVIEW_METRICS } from "@/lib/overview-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const ids = Object.values(OVERVIEW_METRICS).flatMap(Object.values);
    const histories = await getSeriesHistories(ids, 60);
    return NextResponse.json(histories, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Overview API error:", error);
    return NextResponse.json({ error: "Unable to load the economic overview." }, { status: 500 });
  }
}
