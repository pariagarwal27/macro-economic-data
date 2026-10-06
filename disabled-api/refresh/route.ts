import { NextRequest, NextResponse } from "next/server";
import { runIngest } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.REFRESH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "REFRESH_SECRET is not configured" },
      { status: 500 }
    );
  }
  const provided =
    req.headers.get("x-refresh-secret") ??
    req.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "backfill" ? "backfill" : "refresh";
  const summary = await runIngest(mode);
  return NextResponse.json(summary);
}

