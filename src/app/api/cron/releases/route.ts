import { NextResponse } from "next/server";
import { dispatchDueReleases } from "@/ingest/release-dispatcher";
import { refreshNfpForecast } from "@/ingest/nfp-forecast";
import { seedCatalog } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    // The scheduled worker must have catalog rows before its first release
    // poll, including for newly added UK unemployment component series.
    await seedCatalog({
      metricIds: [
        "uk-unemployed-persons",
        "uk-long-term-unemployed",
        "us-ism-manufacturing-employment",
        "us-ism-services-employment",
      ],
      cleanupOrphans: false,
    });
    // Discover the next minute's publications before their scheduled instant.
    // The dispatcher prepares at T-5s and waits for T before issuing requests.
    const result = await dispatchDueReleases({ prepareAheadMs: 65_000, retryForMs: 45_000 });
    let nfpForecast: Awaited<ReturnType<typeof refreshNfpForecast>> | null = null;
    let nfpForecastError: string | null = null;
    try {
      // Every metric release is stored by the dispatcher first. This minute
      // poll then snapshots the NFP model if a newly stored input changed it.
      nfpForecast = await refreshNfpForecast();
    } catch (error) {
      nfpForecastError = error instanceof Error ? error.message : String(error);
      console.error("[cron/releases] NFP forecast refresh failed", error);
    }
    return NextResponse.json({ ok: true, ...result, nfpForecast, nfpForecastError }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/releases]", error);
    return NextResponse.json({ ok: false, error: "Release refresh failed; see Worker logs." }, { status: 500 });
  }
}
