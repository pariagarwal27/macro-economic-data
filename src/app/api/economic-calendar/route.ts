import { NextResponse } from "next/server";
import { and, desc, gte, inArray, lt } from "drizzle-orm";
import { getDashboardCalendarMetrics } from "@/lib/dashboard-calendar-metrics";
import { getEconomicCalendarRows } from "@/lib/economic-calendar-db";
import { buildEconomicCalendar, inheritSharedReleaseSchedules, type CalendarActual } from "@/lib/economic-calendar-view";
import { METRICS } from "@/catalog/metrics";
import { getD1Database, getDb } from "@/db";
import { observations, releases } from "@/db/schema";
import { getCompletedCalendarReleases } from "@/ingest/release-state";
import { applyTransform } from "@/ingest/transforms";
import { cpiUnderlyingScheduleRows } from "@/ingest/cpi-release-schedule";
import { getActiveLiveSource } from "@/ingest/source-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const isCloud = Boolean(getD1Database());
    const catalog = getDashboardCalendarMetrics().map(metric => ({
      ...metric,
      liveSource: getActiveLiveSource(metric.id, isCloud),
    }));
    const displayed = new Set(catalog.map(metric => metric.id));
    const rawSchedule = (await getEconomicCalendarRows({ includeUnscheduled: true })).filter(row => displayed.has(row.metricId));
    const inheritedSchedule = inheritSharedReleaseSchedules(rawSchedule, catalog);
    const cpiSchedule = inheritedSchedule.find(row => row.metricId === "us-cpi");
    const alreadyScheduled = new Set(inheritedSchedule.map(row => row.metricId));
    const derivedUnderlying = cpiSchedule
      ? cpiUnderlyingScheduleRows(cpiSchedule).filter(row => !alreadyScheduled.has(row.metricId))
      : [];
    const schedule = [...inheritedSchedule, ...derivedUnderlying];
    const now = new Date();
    const windowStart = new Date(now.getTime() - 8 * 86_400_000).toISOString();
    const windowEnd = new Date(now.getTime() + 86_400_000).toISOString();
    const actuals: CalendarActual[] = await getDb().select({
      id: releases.id,
      metricId: releases.metricId, periodDate: releases.periodDate, releasedAt: releases.releasedAt,
      value: releases.value, expectedValue: releases.expectedValue,
      priorPeriodValue: releases.priorPeriodValue,
    }).from(releases).where(and(gte(releases.releasedAt, windowStart), lt(releases.releasedAt, windowEnd)));
    const latestRows = await getDb().select({ metricId: releases.metricId, periodDate: releases.periodDate, releasedAt: releases.releasedAt, value: releases.value })
      .from(releases)
      .where(inArray(releases.metricId, catalog.map(metric => metric.id)))
      .orderBy(desc(releases.periodDate), desc(releases.releasedAt));
    const latestValues = new Map<string, number | null>();
    const releaseHistory = new Map<string, { periodDate: string; value: number | null }[]>();
    for (const row of latestRows) {
      if (!latestValues.has(row.metricId)) latestValues.set(row.metricId, row.value);
      const history = releaseHistory.get(row.metricId) ?? [];
      history.push({ periodDate: String(row.periodDate), value: row.value });
      releaseHistory.set(row.metricId, history);
    }
    const derivedRates = catalog.filter(metric =>
      (metric.transform === "pct_change_mom" || metric.transform === "pct_change_yoy") &&
      metric.frequency !== "daily" && metric.frequency !== "hourly" && metric.unit === "percent" && latestValues.get(metric.id) == null,
    );
    const sourceByRate = new Map(derivedRates.flatMap(metric => {
      const source = METRICS.find(candidate => candidate.id !== metric.id && candidate.unit === "index" &&
        candidate.region === metric.region && candidate.releaseName === metric.releaseName && candidate.seriesId === metric.seriesId);
      return source ? [[metric.id, source.id] as const] : [];
    }));
    const sourceIds = [...new Set(sourceByRate.values())];
    if (sourceIds.length) {
      const rows = await getDb().select({ metricId: observations.metricId, date: observations.date, value: observations.value })
        .from(observations).where(inArray(observations.metricId, sourceIds)).orderBy(desc(observations.date));
      const historyById = new Map<string, { date: string; value: number }[]>();
      for (const row of rows) {
        const history = historyById.get(row.metricId) ?? [];
        history.push({ date: String(row.date), value: Number(row.value) });
        historyById.set(row.metricId, history);
      }
      for (const metric of derivedRates) {
        const sourceId = sourceByRate.get(metric.id);
        const history = sourceId ? historyById.get(sourceId)?.slice().reverse() : undefined;
        const latest = history?.length ? applyTransform(history, metric.transform).at(-1) : undefined;
        if (latest && Number.isFinite(latest.value)) latestValues.set(metric.id, latest.value);
      }
    }
    const rawHistory = inheritSharedReleaseSchedules(await getEconomicCalendarRows({ history: true }), catalog);
    const historyCpiRows = rawHistory.filter(row => row.metricId === "us-cpi");
    const historyScheduledKeys = new Set(rawHistory.map(row => `${row.metricId}:${row.nextReleaseDate}`));
    const derivedUnderlyingHistory = historyCpiRows.flatMap(cpiUnderlyingScheduleRows)
      .filter(row => !historyScheduledKeys.has(`${row.metricId}:${row.nextReleaseDate}`));
    const history = [...rawHistory, ...derivedUnderlyingHistory];
    const completions = await getCompletedCalendarReleases(windowStart);
    for (const completion of completions) if (completion.actual && !actuals.some(item=>item.id===completion.actual!.id)) actuals.push(completion.actual);
    return NextResponse.json(buildEconomicCalendar(schedule, actuals, catalog, now, {history,completions,latestValues,releaseHistory}), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Economic calendar API error:", error);
    return NextResponse.json({ error: "Economic calendar unavailable" }, { status: 500 });
  }
}
