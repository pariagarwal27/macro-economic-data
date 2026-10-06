import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/data/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get("region") ?? "ALL";
  const category = req.nextUrl.searchParams.get("category") ?? "ALL";
  const data = await getDashboardData({ region, category });
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

