import { NextRequest, NextResponse } from "next/server";
import { getSeriesHistory } from "@/data/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "240");
  const data = await getSeriesHistory(id, Math.min(Math.max(limit, 24), 2000));
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

