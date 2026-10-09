import type { MetricDef } from "@/catalog/metrics";
import type { ScheduledCalendarRow } from "./economic-calendar-db";

export const CALENDAR_TIME_ZONE = "Europe/London";
export type CalendarActual = { id?: number; metricId: string; releasedAt: string; value: number | null; expectedValue: number | null; priorPeriodValue: number | null };
export type CalendarCompletion = { metricId: string; scheduledAt: string; processedAt: string; releaseId: number | null };
const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const addDays = (key: string, days: number) => { const value = new Date(`${key}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

export function buildEconomicCalendar(schedule: ScheduledCalendarRow[], actuals: CalendarActual[], catalog: MetricDef[], now = new Date(), options: { history?: ScheduledCalendarRow[]; completions?: CalendarCompletion[]; latestValues?: ReadonlyMap<string, number | null> } = {}) {
  const today = dayKey(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday + 6) % 7));
  const weekEnd = addDays(weekStart, 7);
  const byId = new Map(schedule.map(row => [row.metricId, row]));
  const knownSchedules = [...(options.history ?? []), ...schedule];
  const makeEvent = (metric: MetricDef, row?: ScheduledCalendarRow) => {
    const continuous = metric.frequency === "daily" || metric.frequency === "hourly" || row?.status === "daily_series" || ["INFLATION_COMPENSATION", "FED_BREAKEVENS"].includes(row?.family ?? "");
    const hasZone = row?.nextReleaseAt && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(row.nextReleaseAt);
    const timestamp = hasZone ? new Date(row!.nextReleaseAt!) : null;
    const scheduledAt = !continuous && timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
    const rawDate = row?.nextReleaseDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    const validDate = rawDate && !Number.isNaN(Date.parse(`${rawDate}T12:00:00Z`)) ? rawDate : null;
    const scheduledDate = continuous ? null : scheduledAt ? dayKey(new Date(scheduledAt)) : validDate;
    const scheduledTime = scheduledAt ? new Intl.DateTimeFormat("en-GB", { timeZone: CALENDAR_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(scheduledAt)) : null;
    const deadline = row?.releaseDeadlineAt && /(?:Z|[+-]\d{2}:\d{2})$/i.test(row.releaseDeadlineAt) ? new Date(row.releaseDeadlineAt) : null;
    const deadlineAt = deadline && Number.isFinite(deadline.getTime()) ? deadline.toISOString() : null;
    const deadlineTime = deadlineAt ? new Intl.DateTimeFormat('en-GB', {timeZone: CALENDAR_TIME_ZONE, hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(deadlineAt)) : null;
    const scheduledTimeLabel = scheduledTime ?? (deadlineTime ? `${row?.releaseTimeKind === 'before' ? 'Before' : 'By'} ${deadlineTime}` : 'Time unavailable');
    const scheduleType = continuous ? (metric.frequency === "hourly" ? "hourly" as const : "daily" as const) : scheduledDate ? "scheduled" as const : row?.status === "source_error" ? "source-error" as const : "unannounced" as const;
    const startMs = scheduledAt ? Date.parse(scheduledAt) : scheduledDate ? Date.parse(`${scheduledDate}T00:00:00Z`) : Infinity;
    const nextMs = Math.min(Infinity, ...knownSchedules.filter(candidate=>candidate.metricId===metric.id).map(candidate=>Date.parse(candidate.nextReleaseAt ?? `${candidate.nextReleaseDate}T00:00:00Z`)).filter(value=>value>startMs));
    const completion = options.completions?.find(item=>item.metricId===metric.id && item.scheduledAt===(row?.nextReleaseAt ?? row?.nextReleaseDate) && Date.parse(item.processedAt)>=startMs && Date.parse(item.processedAt)<=now.getTime());
    // Durable completion IDs identify the precise committed release, even when
    // a provider timestamps its data earlier than our eventual ingestion.
    const actual = scheduledDate ? actuals.filter(item => {
      if (item.metricId !== metric.id) return false;
      if (!Number.isFinite(Date.parse(item.releasedAt))) return false;
      if (completion?.releaseId != null) return item.id === completion.releaseId;
      const actualMs = Date.parse(item.releasedAt);
      return actualMs >= startMs && actualMs < nextMs && actualMs <= now.getTime() && actualMs-startMs<=8*86_400_000;
    }).sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt))[0] : undefined;
    const status = actual ? "released" as const : !scheduledDate ? "unscheduled" as const : scheduledDate > today ? "upcoming" as const : "pending" as const;
    const scheduleNote = continuous ? `${metric.frequency === "hourly" ? "Hourly" : "Daily"}-frequency series; no discrete announced release time.` : row?.status === "source_error" ? "Source fetch or parsing failed; an official schedule could not be confirmed." : !row ? "No release schedule has been fetched for this catalog metric." : !scheduledDate ? `No confirmed next release date was fetched.${row.officialEvidence ? ` ${row.officialEvidence}` : ""}` : row.nextReleaseAt && !hasZone ? "The source timestamp has no confirmed timezone; no exact time is shown." : !scheduledAt ? `An official date is available, but no confirmed exact time was fetched.${row.officialEvidence ? ` ${row.officialEvidence}` : ""}` : row.officialEvidence;
    return {
      metricId: metric.id, metricName: metric.name, region: metric.region as "US" | "UK" | "EA",
      source: row?.source ?? metric.source, family: row?.family ?? null,
      scheduledDate, scheduledTime, scheduledTimeLabel, scheduledAt, deadlineAt, scheduleType, scheduleNote,
      status, actual: actual?.value ?? null, forecast: actual?.expectedValue ?? null,
      previous: actual ? actual.priorPeriodValue : options.latestValues?.get(metric.id) ?? null, releasedAt: scheduledAt,
      actualReleasedAt: actual?.releasedAt ?? null, officialSource: row?.officialSource ?? metric.officialUrl,
      updatedAt: row?.updatedAt ?? null,
    };
  };
  const compare = (a: ReturnType<typeof makeEvent>, b: ReturnType<typeof makeEvent>) => (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') || (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99') || a.metricName.localeCompare(b.metricName);
  const allEvents = catalog.map(metric=>makeEvent(metric,byId.get(metric.id))).sort(compare);
  const metrics = new Map(catalog.map(metric=>[metric.id,metric]));
  const eventKey = (event: ReturnType<typeof makeEvent>) => `${event.metricId}:${event.scheduledDate}`;
  const combined = new Map<string,ReturnType<typeof makeEvent>>();
  for (const row of options.history ?? []) {
    const metric = metrics.get(row.metricId);
    if (metric) { const event = makeEvent(metric,row); combined.set(eventKey(event),event); }
  }
  for (const event of allEvents) combined.set(eventKey(event),event);
  const events = [...combined.values()].filter(event => event.scheduleType === "scheduled" && event.scheduledDate! >= weekStart && event.scheduledDate! < weekEnd).sort(compare);
  const week: Record<string, typeof events> = {};
  for (const event of events) (week[event.scheduledDate!] ??= []).push(event);
  return {
    today, weekStart, weekEnd, timeZone: CALENDAR_TIME_ZONE,
    todayEvents: events.filter(event => event.scheduledDate === today),
    dailyEvents: allEvents.filter(event => event.scheduleType === "daily" || event.scheduleType === "hourly"), week, allEvents,
    coverage: {
      totalMetrics: catalog.length,
      exactTime: allEvents.filter(event => !!event.scheduledAt).length,
      deadline: allEvents.filter(event=>!event.scheduledAt && !!event.deadlineAt).length,
      dateOnly: allEvents.filter(event => event.scheduleType === "scheduled" && !event.scheduledAt && !event.deadlineAt).length,
      daily: allEvents.filter(event => event.scheduleType === "daily").length,
      hourly: allEvents.filter(event => event.scheduleType === "hourly").length,
      unannounced: allEvents.filter(event => event.scheduleType === "unannounced").length,
      sourceErrors: schedule.filter(row=>row.status === 'source_error').length,
    },
    lastUpdated: schedule.map(row => row.updatedAt).filter(Boolean).sort().at(-1) ?? null,
  };
}
