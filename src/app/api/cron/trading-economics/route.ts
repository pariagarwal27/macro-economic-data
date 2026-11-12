import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { refreshTradingEconomicsCalendar } from "@/ingest/trading-economics-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  let secret = process.env.CRON_SECRET;
  let key = process.env.TRADING_ECONOMICS_API_KEY;
  try {
    const env = getCloudflareContext().env as CloudflareEnv & { TRADING_ECONOMICS_API_KEY?: string };
    secret = env.CRON_SECRET ?? secret;
    key = env.TRADING_ECONOMICS_API_KEY ?? key;
  } catch { /* Local or non-Cloudflare runtime. */ }
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!key) return NextResponse.json({ ok: false, error: "Trading Economics API key is not configured" }, { status: 503 });
  try {
    const result = await refreshTradingEconomicsCalendar(key);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/trading-economics]", error instanceof Error ? error.message : "Refresh failed");
    return NextResponse.json({ ok: false, error: "Trading Economics refresh failed; see server logs." }, { status: 502 });
  }
}
