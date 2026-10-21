import type { ScheduledCalendarRow } from "@/lib/economic-calendar-db";

export type CpiReleaseCandidate = {
  metricId: string;
  scheduledAt: string;
  mode: "scheduled";
};

const BLS_CPI_DEPENDENTS = [
  "us-cpi-yoy",
  "us-core-cpi-mom",
  "us-core-cpi-yoy",
];

const CLEVELAND_CPI_METRICS = [
  "us-cleveland-median-cpi",
  "us-cleveland-trimmed-cpi",
];
const ATLANTA_STICKY_METRICS = ["us-sticky-cpi", "us-core-sticky-cpi", "us-flexible-cpi"];
const UNDERLYING_CPI_METRICS = [...ATLANTA_STICKY_METRICS, ...CLEVELAND_CPI_METRICS];
const UNDERLYING_CPI_REFRESH_METRICS = [
  ...UNDERLYING_CPI_METRICS,
  ...UNDERLYING_CPI_METRICS.map(metricId => `${metricId}-mom`),
];

function isOnCpiReleaseDay(scheduledAt: Date, now: Date) {
  if (now.getTime() < scheduledAt.getTime()) return false;
  const dateInNewYork = (date: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return dateInNewYork(now) === dateInNewYork(scheduledAt);
}

function utcAtLocalTime(date: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;

  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(desired));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return new Date(desired + desired - represented);
}

/**
 * CPI-linked releases that do not have a dependable standalone calendar row
 * share the CPI release date. Atlanta Sticky CPI publishes by 11:00 a.m. ET;
 * the Cleveland Fed measures are polled on the same CPI-release-day window.
 */
export function cpiReleaseCandidates(
  rows: Pick<ScheduledCalendarRow, "metricId" | "nextReleaseDate" | "nextReleaseAt">[],
  now: Date
): CpiReleaseCandidate[] {
  const cpi = rows.find((row) => row.metricId === "us-cpi");
  if (!cpi?.nextReleaseDate) return [];

  const blsAt = cpi.nextReleaseAt
    ? new Date(cpi.nextReleaseAt)
    : utcAtLocalTime(cpi.nextReleaseDate, 8, 30, "America/New_York");
  if (!blsAt || !Number.isFinite(blsAt.getTime())) return [];

  const underlyingAt = utcAtLocalTime(cpi.nextReleaseDate, 11, 0, "America/New_York");
  if (!underlyingAt) return [];

  return [
    ...BLS_CPI_DEPENDENTS.map((metricId) => ({ metricId, scheduledAt: blsAt })),
    ...UNDERLYING_CPI_REFRESH_METRICS.map((metricId) => ({ metricId, scheduledAt: underlyingAt })),
  ]
    .filter(({ scheduledAt }) => isOnCpiReleaseDay(scheduledAt, now))
    .map(({ metricId, scheduledAt }) => ({
      metricId,
      scheduledAt: scheduledAt.toISOString(),
      mode: "scheduled" as const,
    }));
}

export const CPI_CALENDAR_DEPENDENT_METRIC_IDS = new Set([
  ...BLS_CPI_DEPENDENTS,
  ...CLEVELAND_CPI_METRICS,
  ...ATLANTA_STICKY_METRICS,
  ...UNDERLYING_CPI_METRICS.map(metricId => `${metricId}-mom`),
]);

/** Derive separate economic-calendar rows from the confirmed CPI date. */
export function cpiUnderlyingScheduleRows(cpi: Pick<ScheduledCalendarRow, "nextReleaseDate" | "nextReleaseAt">) {
  if (!cpi.nextReleaseDate) return [];
  const scheduledAt = utcAtLocalTime(cpi.nextReleaseDate, 11, 0, "America/New_York");
  if (!scheduledAt) return [];
  return UNDERLYING_CPI_METRICS.map(metricId => ({
    metricId, metricName: null, source: metricId.startsWith("us-cleveland") ? "cleveland" : "atlanta",
    family: "US CPI dependent", nextReleaseDate: cpi.nextReleaseDate, nextReleaseAt: scheduledAt.toISOString(),
    status: "scheduled", officialSource: metricId.startsWith("us-cleveland")
      ? "https://www.clevelandfed.org/indicators-and-data/median-cpi"
      : "https://www.atlantafed.org/research-and-data/data/sticky-price-cpi",
    updatedAt: null,
  }));
}
