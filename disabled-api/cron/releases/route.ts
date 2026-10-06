import { NextResponse } from "next/server";
import { dispatchDueReleases } from "@/ingest/release-dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result = await dispatchDueReleases({
      maxMetrics: Number(process.env.RELEASE_MAX_METRICS_PER_CYCLE ?? 40),
    });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[cron/releases]", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
