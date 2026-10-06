import { NextResponse } from "next/server";
import { refreshJoltsIfNew } from "@/ingest/jolts-live-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured" },
        { status: 500 }
      );
    }

    const auth = request.headers.get("authorization");

    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await refreshJoltsIfNew();

    return NextResponse.json({
      ok: true,
      ...result,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("JOLTS live refresh failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "JOLTS refresh failed",
      },
      { status: 500 }
    );
  }
}