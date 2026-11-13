import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDashboardCalendarMetrics } from "@/lib/dashboard-calendar-metrics";
import { getEconomicCalendarRows } from "@/lib/economic-calendar-db";
import { buildEconomicCalendar, inheritSharedReleaseSchedules, type CalendarActual } from "@/lib/economic-calendar-view";
import { METRICS } from "@/catalog/metrics";
import { getDb } from "@/db";
import { calendarEvents, observations, releases } from "@/db/schema";
import { investingForecastToMetricValue } from "@/ingest/investing-calendar";
import { resolveShowMyTradesMetric } from "@/ingest/showmytrades-calendar";
import { getCompletedCalendarReleases } from "@/ingest/release-state";
import { applyTransform } from "@/ingest/transforms";
import { cpiUnderlyingScheduleRows } from "@/ingest/cpi-release-schedule";
import { getActiveLiveSource } from "@/ingest/source-registry";
import { PCE_RATE_SOURCES } from "@/lib/pce-release";
import { canonicalPceCalendarActuals } from "@/lib/pce-calendar";
import { canonicalCpiCalendarActuals, CPI_RATE_SOURCES } from "@/lib/cpi-calendar";
import { releaseStageFromNote } from "@/ingest/release-stages";
import { missingEurostatGdpScheduleFallbacks } from "@/ingest/eurostat-release-schedules";
import { isLaborChangeMetric } from "@/lib/labor-period-change";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const catalog = getDashboardCalendarMetrics().map(metric => ({
      ...metric,
      liveSource: getActiveLiveSource(metric.id),
    }));
    const displayed = new Set(catalog.map(metric => metric.id));
    // Keep BEA's parent PCE schedule available for Cleveland Median PCE to
    // inherit its exact date/time; the parent row itself is filtered from the
    // final diary because it is not a displayed metric.
    const scheduleInheritanceParents = new Set(["us-pce"]);
    const rawSchedule = (await getEconomicCalendarRows({ includeUnscheduled: true }))
      .filter(row => displayed.has(row.metricId) || scheduleInheritanceParents.has(row.metricId));
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
    const forecastEnd = new Date(now.getTime() + 9 * 86_400_000).toISOString();
    // Accept forecasts from the legacy Investing.com import and ShowMyTrades.
    const forecastRows = await getDb().select({ metricId: calendarEvents.metricId, eventName: calendarEvents.eventName, source: calendarEvents.source, releasedAt: calendarEvents.releasedAt, forecast: calendarEvents.forecast })
      .from(calendarEvents)
      .where(and(inArray(calendarEvents.source, ["investing", "showmytrades"]), gte(calendarEvents.importedAt, new Date(now.getTime() - 48 * 3600000).toISOString()), gte(calendarEvents.releasedAt, windowStart), lt(calendarEvents.releasedAt, forecastEnd)))
      .orderBy(desc(calendarEvents.importedAt));
    const forecasts = new Map<string, number>();
    for (const row of forecastRows) {
      const metricId = row.source === "showmytrades" ? resolveShowMyTradesMetric(row.metricId, row.eventName) : row.metricId;
      if (!metricId || row.forecast == null || !Number.isFinite(row.forecast)) continue;
      const date = new Date(row.releasedAt);
      if (!Number.isFinite(date.getTime())) continue;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      const key = `${metricId}:${day}`;
      if (!forecasts.has(key)) forecasts.set(key, investingForecastToMetricValue(metricId, row.forecast));
    }
    const latestConsensusSync = await getDb().select({ importedAt: calendarEvents.importedAt })
      .from(calendarEvents)
      .where(eq(calendarEvents.source, "showmytrades"))
      .orderBy(desc(calendarEvents.importedAt))
      .limit(1);
    const actuals = await getDb().select({
      id: releases.id,
      metricId: releases.metricId, periodDate: releases.periodDate, releasedAt: releases.releasedAt,
      value: releases.value, expectedValue: releases.expectedValue,
      priorPeriodValue: releases.priorPeriodValue,
      notes: releases.notes,
    }).from(releases).where(and(gte(releases.releasedAt, windowStart), lt(releases.releasedAt, windowEnd)));
    const stagedActuals: CalendarActual[] = actuals.map(row => ({
      ...row,
      releaseStage: releaseStageFromNote(row.notes),
    }));
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
    const latestPeriodChanges = new Map<string, number | null>();
    for (const [metricId, rows] of releaseHistory) {
      if (!isLaborChangeMetric(metricId)) continue;
      const uniquePeriods = new Map<string, number | null>();
      for (const row of rows) if (!uniquePeriods.has(row.periodDate)) uniquePeriods.set(row.periodDate, row.value);
      const periods = [...uniquePeriods.entries()];
      const [latestPeriod, latestValue] = periods[0] ?? [];
      const [priorPeriod, priorValue] = periods[1] ?? [];
      const latestMonth = latestPeriod?.match(/^(\d{4})-(\d{2})/);
      const priorMonth = priorPeriod?.match(/^(\d{4})-(\d{2})/);
      const adjacent = latestMonth && priorMonth &&
        Number(latestMonth[1]) * 12 + Number(latestMonth[2]) === Number(priorMonth[1]) * 12 + Number(priorMonth[2]) + 1;
      latestPeriodChanges.set(metricId, adjacent && latestValue != null && priorValue != null
        ? Number((latestValue - priorValue).toFixed(10))
        : null);
    }
    const derivedRates = catalog.filter(metric =>
      (metric.transform === "pct_change_mom" || metric.transform === "pct_change_yoy") &&
      metric.frequency !== "daily" && metric.frequency !== "hourly" && metric.unit === "percent" &&
      (latestValues.get(metric.id) == null || metric.id in PCE_RATE_SOURCES || metric.id in CPI_RATE_SOURCES),
    );
    const sourceByRate = new Map(derivedRates.flatMap(metric => {
      const source = METRICS.find(candidate => candidate.id !== metric.id && candidate.unit === "index" &&
        candidate.region === metric.region && candidate.releaseName === metric.releaseName && candidate.seriesId === metric.seriesId);
      return source ? [[metric.id, source.id] as const] : [];
    }));
    const sourceIds = [...new Set(sourceByRate.values())];
    const historyById = new Map<string, { date: string; value: number }[]>();
    if (sourceIds.length) {
      const rows = await getDb().select({ metricId: observations.metricId, date: observations.date, value: observations.value, id: observations.id })
        .from(observations).where(inArray(observations.metricId, sourceIds)).orderBy(desc(observations.date), desc(observations.id));
      for (const row of rows) {
        const history = historyById.get(row.metricId) ?? [];
        if (history.some(point => point.date === String(row.date))) continue;
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
    const history = [...rawHistory, ...derivedUnderlyingHistory,
      ...missingEurostatGdpScheduleFallbacks([...schedule, ...rawHistory, ...derivedUnderlyingHistory])];
    const completions = await getCompletedCalendarReleases(windowStart);
    for (const completion of completions) if (completion.actual && !stagedActuals.some(item=>item.id===completion.actual!.id)) stagedActuals.push(completion.actual);
    const canonicalPce = canonicalPceCalendarActuals(stagedActuals, completions, historyById);
    const canonicalCpi = canonicalCpiCalendarActuals(canonicalPce.actuals, canonicalPce.completions, historyById);
    return NextResponse.json({
      ...buildEconomicCalendar(schedule, canonicalCpi.actuals, catalog, now, {history,completions:canonicalCpi.completions,latestValues,latestPeriodChanges,releaseHistory,forecasts}),
      consensusUpdatedAt: latestConsensusSync[0]?.importedAt ?? null,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Economic calendar API error:", error);
    return NextResponse.json({ error: "Economic calendar unavailable" }, { status: 500 });
  }
}
