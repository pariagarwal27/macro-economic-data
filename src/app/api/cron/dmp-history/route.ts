import { NextResponse } from "next/server";
import { runIngest } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const DMP_METRIC_IDS = [
  "uk-dmp-inflation-exp-1y",
  "uk-dmp-inflation-exp-3y",
  "uk-dmp-own-price-exp-1y",
  "uk-dmp-wage-exp-1y",
  "uk-dmp-wage-exp-1y-3m",
  "uk-dmp-wage-growth-3m",
];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Refresh the full official workbook history so both new months and
    // subsequent BoE revisions are merged into the stored DMP series.
    const result = await runIngest("refresh", { metricIds: DMP_METRIC_IDS });
    const ok = result.metricsProcessed === DMP_METRIC_IDS.length && result.failures.length === 0;
    return NextResponse.json(
      { ok, ...result },
      { status: ok ? 200 : 502, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron/dmp-history]", error);
    return NextResponse.json({ ok: false, error: "DMP history refresh failed; see Worker logs." }, { status: 500 });
  }
}
