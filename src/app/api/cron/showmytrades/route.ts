import { NextResponse } from "next/server";
import { refreshShowMyTradesCalendar } from "@/ingest/showmytrades-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await refreshShowMyTradesCalendar();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/showmytrades]", error instanceof Error ? error.message : "Refresh failed");
    return NextResponse.json({ ok: false, error: "ShowMyTrades refresh failed; see server logs." }, { status: 502 });
  }
}
