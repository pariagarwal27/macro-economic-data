import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { runIngest } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const BOE_DAILY_YIELD_CURVE_METRICS = [
  "uk-inflation-comp-5y",
  "uk-inflation-comp-10y",
  "uk-inflation-comp-5y5y",
];

export async function GET(request: Request) {
  let secret = process.env.CRON_SECRET;
  try { secret = getCloudflareContext().env.CRON_SECRET ?? secret; } catch { /* Local or non-Cloudflare runtime. */ }
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // The BoE aims to publish daily yield curves by noon on the next business day.
    // This 12:30 UTC weekday refresh runs after that deadline year-round.
    const result = await runIngest("refresh", { metricIds: BOE_DAILY_YIELD_CURVE_METRICS });
    const ok = result.metricsProcessed === BOE_DAILY_YIELD_CURVE_METRICS.length && result.failures.length === 0;
    return NextResponse.json(
      { ok, ...result },
      { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron/boe-daily-yield-curves]", error);
    return NextResponse.json({ ok: false, error: "Daily BoE yield-curve refresh failed; see Worker logs." }, { status: 500 });
  }
}
