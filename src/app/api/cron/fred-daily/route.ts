import { NextResponse } from "next/server";
import { runIngest } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const DAILY_FRED_METRIC_IDS = [
  "us-breakeven-5y", // T5YIE
  "us-breakeven-10y", // T10YIE
  "us-5y5y-forward", // T5YIFR
];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // FRED updates these daily Interest Rate Spreads at 4:03 p.m. Central.
    // The 22:17 UTC weekday cron runs after that update in both CST and CDT.
    const result = await runIngest("refresh", { metricIds: DAILY_FRED_METRIC_IDS });
    const ok = result.metricsProcessed === DAILY_FRED_METRIC_IDS.length && result.failures.length === 0;
    return NextResponse.json(
      { ok, ...result },
      { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron/fred-daily]", error);
    return NextResponse.json({ ok: false, error: "Daily FRED refresh failed; see Worker logs." }, { status: 500 });
  }
}
