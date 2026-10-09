import { NextRequest, NextResponse } from "next/server";
import { getReleaseTape } from "@/data/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get("region") ?? "ALL";
  const days = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const kind = (req.nextUrl.searchParams.get("kind") ?? "all") as
    | "all"
    | "data"
    | "speakers"
    | "policy";
  const forwardOnly = req.nextUrl.searchParams.get("forwardOnly") !== "false";
  const pastOnly = req.nextUrl.searchParams.get("pastOnly") === "true";

  const tape = await getReleaseTape({
    region,
    days: Math.min(Math.max(days, 1), 30),
    kind,
    forwardOnly,
    pastOnly,
  });

  return NextResponse.json(tape, { headers: { "Cache-Control": "no-store" } });
}

