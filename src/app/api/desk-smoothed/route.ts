import { NextRequest, NextResponse } from "next/server";
import { getDeskSmoothedData } from "@/data/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const months = Number(req.nextUrl.searchParams.get("months") ?? "12");
  const data = await getDeskSmoothedData({
    months: Math.min(Math.max(months, 3), 24),
  });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

