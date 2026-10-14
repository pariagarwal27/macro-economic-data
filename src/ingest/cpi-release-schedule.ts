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

const MAX_RELEASE_WINDOW_MS = 3 * 24 * 60 * 60_000;

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

function isWithinReleaseWindow(scheduledAt: Date, now: Date) {
  const elapsed = now.getTime() - scheduledAt.getTime();
  return elapsed >= 0 && elapsed <= MAX_RELEASE_WINDOW_MS;
}

/**
 * Some BLS CPI sub-series are absent from the release calendar. Cleveland
 * Fed's Median and Trimmed-Mean CPI share the CPI release date but publish at
 * 10:00 a.m. US Central time, so schedule those dependent fetches explicitly.
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

  const clevelandAt = utcAtLocalTime(cpi.nextReleaseDate, 10, 0, "America/Chicago");
  if (!clevelandAt) return [];

  return [
    ...BLS_CPI_DEPENDENTS.map((metricId) => ({ metricId, scheduledAt: blsAt })),
    ...CLEVELAND_CPI_METRICS.map((metricId) => ({ metricId, scheduledAt: clevelandAt })),
  ]
    .filter(({ scheduledAt }) => isWithinReleaseWindow(scheduledAt, now))
    .map(({ metricId, scheduledAt }) => ({
      metricId,
      scheduledAt: scheduledAt.toISOString(),
      mode: "scheduled" as const,
    }));
}

export const CPI_CALENDAR_DEPENDENT_METRIC_IDS = new Set([
  ...BLS_CPI_DEPENDENTS,
  ...CLEVELAND_CPI_METRICS,
]);
