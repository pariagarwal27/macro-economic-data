import { NextResponse } from "next/server";
import { getDataFreshness } from "@/lib/data-freshness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = await getDataFreshness();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}

