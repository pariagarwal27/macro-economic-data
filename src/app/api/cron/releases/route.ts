import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { dispatchDueReleases } from "@/ingest/release-dispatcher";
import { seedCatalog } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  let secret = process.env.CRON_SECRET;
  try { secret = getCloudflareContext().env.CRON_SECRET ?? secret; } catch { /* Local worker. */ }
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    // The scheduled worker must have catalog rows before its first release
    // poll, including for newly added UK unemployment component series.
    await seedCatalog({
      metricIds: ["uk-unemployed-persons", "uk-long-term-unemployed"],
      cleanupOrphans: false,
    });
    // Discover the next minute's publications before their scheduled instant.
    // The dispatcher prepares at T-5s and waits for T before issuing requests.
    const result = await dispatchDueReleases({ prepareAheadMs: 65_000, retryForMs: 45_000 });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/releases]", error);
    return NextResponse.json({ ok: false, error: "Release refresh failed; see Worker logs." }, { status: 500 });
  }
}
