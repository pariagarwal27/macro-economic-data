import { NextResponse } from "next/server";

import { runIngest } from "@/ingest/pipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      {
        error:
          "Manual refresh is disabled in production. The release cron performs automatic official-source refreshes.",
      },
      { status: 403 }
    );
  }

  try {
    const summary = await runIngest("refresh");

    return NextResponse.json(summary, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Refresh data error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh data.",
      },
      { status: 500 }
    );
  }
}