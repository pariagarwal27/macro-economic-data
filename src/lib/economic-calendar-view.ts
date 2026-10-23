import type { MetricDef } from "@/catalog/metrics";
import type { ScheduledCalendarRow } from "./economic-calendar-db";

export const CALENDAR_TIME_ZONE = "Europe/London";
export type CalendarActual = { id?: number; metricId: string; periodDate?: string | null; releasedAt: string; value: number | null; expectedValue: number | null; priorPeriodValue: number | null };
export type CalendarCompletion = { metricId: string; scheduledAt: string; processedAt: string; releaseId: number | null };
export type CalendarReleaseHistory = ReadonlyMap<string, readonly { periodDate: string; value: number | null }[]>;
export type CalendarRegionFilter = "ALL" | "US" | "UK" | "EA";
const INFLATION_EXPECTATION_LABELS: Readonly<Record<string, string>> = {
  expectations_business: "Business Expectations",
  expectations_consumer: "Consumer Expectations",
  expectations_professional: "Professional Expectations",
  expectations_market: "Market Expectations",
  expectations_model: "Model-based Expectations",
  expectations_wage: "Wage Expectations",
  expectations_wages: "Wage Expectations",
};
const EXPECTATION_COMPONENTS: Readonly<Record<string, string>> = {
  "Business Inflation Expectations": "Atlanta BIE",
  "BoE Inflation Attitudes Survey": "BoE Inflation Attitudes",
  "BoE Decision Maker Panel": "BoE DMP",
  "BoE Agents' Pay Survey": "BoE Agents",
  "ECB Consumer Expectations Survey": "ECB CES",
  "ECB SAFE Survey": "ECB SAFE",
  "ECB Survey of Professional Forecasters": "ECB SPF",
  "Survey of Consumer Expectations": "NY Fed SCE",
  "Michigan Survey of Consumers": "University of Michigan",
  "TIPS Breakevens": "TIPS Breakevens",
  "UK Inflation Compensation": "BoE Inflation Compensation",
  "Euro Area Inflation Compensation": "LSEG Inflation Compensation",
};
const EA_HICP_DISPLAY: Readonly<Record<string, { name: string; order: number }>> = {
  "ea-core-hicp-yoy": { name: "Core HICP YoY", order: 0 },
  "ea-core-hicp-mom": { name: "Core HICP MoM", order: 1 },
  "ea-hicp-yoy": { name: "Headline HICP YoY", order: 2 },
  "ea-hicp-mom": { name: "Headline HICP MoM", order: 3 },
  "ea-services-hicp-mom": { name: "Services HICP MoM", order: 4 },
  "ea-services-hicp-yoy": { name: "Services HICP YoY", order: 5 },
};
export function calendarMetricDisplayName(metric: Pick<MetricDef, "id" | "name" | "category" | "subcategory" | "source" | "shortName" | "releaseName">) {
  const specialName = EA_HICP_DISPLAY[metric.id]?.name;
  if (specialName) return specialName;
  const expectationCategory = metric.category === "inflation" ? INFLATION_EXPECTATION_LABELS[metric.subcategory] : null;
  if (!expectationCategory) return metric.name;
  const component = EXPECTATION_COMPONENTS[metric.releaseName] ?? (metric.source === "fred"
    ? metric.subcategory === "expectations_market" ? "TIPS Breakevens" : "Cleveland Fed"
    : metric.source === "cleveland" ? "Cleveland Fed"
    : metric.source === "cleveland_sofie" ? "Cleveland SoFIE"
    : metric.source === "lseg" ? "LSEG"
    : metric.shortName);
  return `${expectationCategory} (${component})`;
}
export function compareCalendarMetricEvents(a: { metricId: string; metricName: string }, b: { metricId: string; metricName: string }) {
  const retailOrder = ['uk-retail-sales-total-ex-fuel', 'uk-retail-sales-ex-fuel'];
  if (retailOrder.includes(a.metricId) && retailOrder.includes(b.metricId)) return retailOrder.indexOf(a.metricId) - retailOrder.indexOf(b.metricId);
  const aOrder = EA_HICP_DISPLAY[a.metricId]?.order;
  const bOrder = EA_HICP_DISPLAY[b.metricId]?.order;
  if (aOrder != null || bOrder != null) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
  return a.metricName.localeCompare(b.metricName);
}
const dayKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const addDays = (key: string, days: number) => { const value = new Date(`${key}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

/** Convert a publisher's local wall time to UTC while accounting for DST. */
function utcAtLocalTime(date: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const desiredLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredLocalAsUtc;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const observedLocalAsUtc = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second));
    candidate += desiredLocalAsUtc - observedLocalAsUtc;
  }
  return new Date(candidate);
}

/** A no-date placeholder must not block an agency calendar shared by related measures. */
export function inheritSharedReleaseSchedules<T extends { metricId: string; nextReleaseDate: string | null; nextReleaseAt: string | null }>(
  rows: readonly T[], catalog: readonly MetricDef[],
): T[] {
  const metricsById = new Map(catalog.map(metric => [metric.id, metric]));
  const datedRows = rows.filter(row => row.nextReleaseDate || row.nextReleaseAt);
  const scheduledMetricIds = new Set(datedRows.map(row => row.metricId));
  const inherited = catalog.flatMap(metric => {
    if (scheduledMetricIds.has(metric.id) || metric.frequency === "daily" || metric.frequency === "hourly") return [];
    const peer = catalog.find(candidate => candidate.id !== metric.id && candidate.region === metric.region &&
      candidate.source === metric.source && candidate.releaseName === metric.releaseName && scheduledMetricIds.has(candidate.id));
    return peer ? datedRows.filter(row => row.metricId === peer.id).map(row => ({ ...row, metricId: metric.id, metricName: metric.name })) : [];
  });
  const inheritedIds = new Set(inherited.map(row => row.metricId));
  return [...rows.filter(row => !inheritedIds.has(row.metricId)), ...inherited].filter(row => metricsById.has(row.metricId));
}

/** Keep continuous daily/hourly observations out of the release diary. */
export function filterScheduledCalendarEvents<T extends { scheduleType: string; region: string }>(events: readonly T[], region: CalendarRegionFilter = "ALL"): T[] {
  return events.filter(event => event.scheduleType === "scheduled" && (region === "ALL" || event.region === region));
}

export function isWithinLastSevenCalendarDays(scheduledDate: string | null, scheduleType: string, today: string) {
  return scheduleType === "scheduled" && !!scheduledDate && scheduledDate >= addDays(today, -6) && scheduledDate <= today;
}

export function filterReleaseDiaryEvents<T extends { scheduleType: string; region: string; scheduledDate: string | null; status: string }>(
  events: readonly T[], tab: "upcoming" | "history", today: string, region: CalendarRegionFilter = "ALL",
): T[] {
  return filterScheduledCalendarEvents(events, region).filter(event => tab === "history"
    ? event.status === "released" && isWithinLastSevenCalendarDays(event.scheduledDate, event.scheduleType, today)
    : !!event.scheduledDate && event.scheduledDate >= today && event.scheduledDate <= addDays(today, 7));
}

/** Past 7 calendar days through today, plus the next 7 calendar days. */
export function isWithinPastAndNextSevenCalendarDays(scheduledDate: string | null, scheduleType: string, today: string) {
  return scheduleType === "scheduled" && !!scheduledDate && scheduledDate >= addDays(today, -6) && scheduledDate <= addDays(today, 7);
}

export function buildEconomicCalendar(schedule: ScheduledCalendarRow[], actuals: CalendarActual[], catalog: (MetricDef & { liveSource?: string | null })[], now = new Date(), options: { history?: ScheduledCalendarRow[]; completions?: CalendarCompletion[]; latestValues?: ReadonlyMap<string, number | null>; releaseHistory?: CalendarReleaseHistory } = {}) {
  const today = dayKey(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday + 6) % 7));
  const weekEnd = addDays(weekStart, 7);
  const byId = new Map(schedule.map(row => [row.metricId, row]));
  const knownSchedules = [...(options.history ?? []), ...schedule];
  const makeEvent = (metric: MetricDef & { liveSource?: string | null }, row?: ScheduledCalendarRow) => {
    const continuous = metric.frequency === "daily" || metric.frequency === "hourly" || row?.status === "daily_series" || ["INFLATION_COMPENSATION", "FED_BREAKEVENS"].includes(row?.family ?? "");
    const rawDate = row?.nextReleaseDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    const hasZone = row?.nextReleaseAt && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(row.nextReleaseAt);
    // Atlanta Fed publishes BIE on its listed Wednesday and the recurring
    // market calendar convention is 10:00 ET. The Fed's official schedule
    // confirms the date, but does not publish an exact hour.
    const atlantaBieTime = metric.source === "atlanta" && row?.family === "ATLANTA_BIE" && rawDate
      ? utcAtLocalTime(rawDate, 10, 0, "America/New_York")
      : null;
    const timestamp = hasZone ? new Date(row!.nextReleaseAt!) : atlantaBieTime;
    const scheduledAt = !continuous && timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
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
    const scheduledTimeHasPassed = scheduledAt ? Date.parse(scheduledAt) <= now.getTime() : false;
    const isScheduledInFuture = Boolean(scheduledDate && (scheduledDate > today || (scheduledAt && !scheduledTimeHasPassed)));
    const status = actual ? "released" as const : !scheduledDate ? "unscheduled" as const : isScheduledInFuture ? "upcoming" as const : "pending" as const;
    const scheduleNote = continuous ? `${metric.frequency === "hourly" ? "Hourly" : "Daily"}-frequency series; no discrete announced release time.` : row?.status === "source_error" ? "Source fetch or parsing failed; an official schedule could not be confirmed." : !row ? "No release schedule has been fetched for this catalog metric." : !scheduledDate ? `No confirmed next release date was fetched.${row.officialEvidence ? ` ${row.officialEvidence}` : ""}` : row.nextReleaseAt && !hasZone && !atlantaBieTime ? "The source timestamp has no confirmed timezone; no exact time is shown." : atlantaBieTime ? `10:00 ET is the recurring calendar time for Atlanta Fed BIE; the official source confirms the release date but does not state an hour. ${row.officialEvidence ?? ""}`.trim() : !scheduledAt ? `An official date is available, but no confirmed exact time was fetched.${row.officialEvidence ? ` ${row.officialEvidence}` : ""}` : row.officialEvidence;
    return {
      metricId: metric.id, metricName: calendarMetricDisplayName(metric), region: metric.region as "US" | "UK" | "EA",
      unit: metric.unit,
      source: row?.source ?? metric.source, liveSource: metric.liveSource ?? null, family: row?.family ?? null,
      scheduledDate, scheduledTime, scheduledTimeLabel, scheduledAt, deadlineAt, scheduleType, scheduleNote,
      status, actual: actual?.value ?? null, forecast: actual?.expectedValue ?? null,
      previous: actual
        ? actual.priorPeriodValue ?? (actual.periodDate
          ? options.releaseHistory?.get(metric.id)?.find(item => item.periodDate < actual.periodDate!)?.value ?? null
          : null)
        : options.latestValues?.get(metric.id) ?? null,
      releasedAt: scheduledAt,
      actualReleasedAt: actual?.releasedAt ?? null, officialSource: row?.officialSource ?? metric.officialUrl,
      updatedAt: row?.updatedAt ?? null,
    };
  };
  const compare = (a: ReturnType<typeof makeEvent>, b: ReturnType<typeof makeEvent>) => (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') || (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99') || compareCalendarMetricEvents(a, b);
  const pceIndexLevelIds = new Set(['us-pce', 'us-core-pce']);
  const allEvents = catalog.filter(metric => !pceIndexLevelIds.has(metric.id))
    .map(metric => makeEvent(metric, byId.get(metric.id))).sort(compare);
  // All Metrics describes the next publication; completed publications remain
  // in allEvents/recentEvents for the diary and release notifications.
  const nextReleaseEvents = allEvents.map(event => {
    if (event.status !== "released") return event;
    const metric = catalog.find(metric => metric.id === event.metricId)!;
    const next = knownSchedules
      .filter(row => row.metricId === event.metricId)
      .map(row => makeEvent(metric, row))
      .filter(candidate => candidate.status !== "released" && candidate.scheduledDate &&
        (candidate.scheduledAt ? Date.parse(candidate.scheduledAt) > now.getTime() : candidate.scheduledDate >= today))
      .sort(compare)[0];
    return next ?? {
      ...makeEvent(metric),
      scheduleType: "source-error" as const,
      source: event.source,
      family: event.family,
      previous: event.actual,
      updatedAt: event.updatedAt,
      scheduleNote: "The previous release has been published, but the calendar has not fetched its next release date. This does not mean the official source has not announced it.",
    };
  }).sort(compare);
  const metrics = new Map(catalog.map(metric=>[metric.id,metric]));
  const eventKey = (event: ReturnType<typeof makeEvent>) => `${event.metricId}:${event.scheduledDate}`;
  const combined = new Map<string,ReturnType<typeof makeEvent>>();
  for (const row of options.history ?? []) {
    const metric = metrics.get(row.metricId);
    if (metric) { const event = makeEvent(metric,row); combined.set(eventKey(event),event); }
  }
  for (const event of allEvents) combined.set(eventKey(event),event);
  const events = [...combined.values()].filter(event => event.scheduleType === "scheduled" && event.scheduledDate! >= weekStart && event.scheduledDate! < weekEnd).sort(compare);
  const recentEvents = [...combined.values()].filter(event => isWithinLastSevenCalendarDays(event.scheduledDate, event.scheduleType, today)).sort(compare);
  const week: Record<string, typeof events> = {};
  for (const event of events) (week[event.scheduledDate!] ??= []).push(event);
  return {
    today, weekStart, weekEnd, timeZone: CALENDAR_TIME_ZONE,
    todayEvents: events.filter(event => event.scheduledDate === today),
    dailyEvents: allEvents.filter(event => event.scheduleType === "daily" || event.scheduleType === "hourly"), week, allEvents, nextReleaseEvents,
    recentEvents,
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
