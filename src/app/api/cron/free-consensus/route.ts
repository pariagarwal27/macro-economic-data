import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { refreshFreeConsensus } from "@/ingest/free-consensus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  let secret = process.env.CRON_SECRET;
  try {
    const env = getCloudflareContext().env as CloudflareEnv;
    secret = env.CRON_SECRET ?? secret;
  } catch { /* Local or non-Cloudflare runtime. */ }
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const result = await refreshFreeConsensus();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/free-consensus]", error instanceof Error ? error.message : "Refresh failed");
    return NextResponse.json({ ok: false, error: "Free consensus refresh failed; see server logs." }, { status: 502 });
  }
}
