import { NextRequest, NextResponse } from "next/server";
import { and, gte, lt } from "drizzle-orm";
import { METRICS } from "@/catalog/metrics";
import { getEconomicCalendarRows } from "@/lib/economic-calendar-db";
import { buildEconomicCalendar, type CalendarActual } from "@/lib/economic-calendar-view";
import { getDb } from "@/db";
import { releases } from "@/db/schema";
import { getCompletedCalendarReleases } from "@/ingest/release-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  try {
    const schedule = await getEconomicCalendarRows({ includeUnscheduled: true });
    const now = new Date();
    const windowStart = new Date(now.getTime() - 8 * 86_400_000).toISOString();
    const windowEnd = new Date(now.getTime() + 86_400_000).toISOString();
    const actuals: CalendarActual[] = await getDb().select({
      id: releases.id,
      metricId: releases.metricId, releasedAt: releases.releasedAt,
      value: releases.value, expectedValue: releases.expectedValue,
      priorPeriodValue: releases.priorPeriodValue,
    }).from(releases).where(and(gte(releases.releasedAt, windowStart), lt(releases.releasedAt, windowEnd)));
    const history = await getEconomicCalendarRows({ history: true });
    const completions = await getCompletedCalendarReleases(windowStart);
    for (const completion of completions) if (completion.actual && !actuals.some(item=>item.id===completion.actual!.id)) actuals.push(completion.actual);
    return NextResponse.json(buildEconomicCalendar(schedule, actuals, METRICS, now, {history,completions}), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Economic calendar API error:", error);
    return NextResponse.json({ error: "Economic calendar unavailable" }, { status: 500 });
  }
}
