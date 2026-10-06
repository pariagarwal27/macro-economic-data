import { NextResponse } from "next/server";
import { getUsInflationDashboard } from "@/ingest/us-inflation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getUsInflationDashboard(), {
    headers: { "Cache-Control": "no-store" },
  });
}
