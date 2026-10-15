import type { ScheduledCalendarRow } from "@/lib/economic-calendar-db";

export function retryableHistoricalSchedules(
  currentRows: readonly ScheduledCalendarRow[],
  historyRows: readonly ScheduledCalendarRow[],
  now: Date,
  maxAgeMs = 3 * 86_400_000,
): ScheduledCalendarRow[] {
  const activeKeys = new Set(currentRows.map(scheduleKey));
  return historyRows.filter(row => {
    if (!row.metricId || !row.nextReleaseDate) return false;
    if (activeKeys.has(scheduleKey(row))) return false;
    const scheduledAt = row.nextReleaseAt && Number.isFinite(Date.parse(row.nextReleaseAt))
      ? Date.parse(row.nextReleaseAt)
      : Date.parse(`${row.nextReleaseDate.slice(0, 10)}T23:59:59.999Z`);
    const ageMs = now.getTime() - scheduledAt;
    return Number.isFinite(scheduledAt) && ageMs >= 0 && ageMs <= maxAgeMs;
  });
}

export function wasRecordedAfterSchedule(releasedAt: string, scheduledAt: string) {
  const releasedMs = Date.parse(releasedAt);
  const scheduledMs = Date.parse(scheduledAt);
  return Number.isFinite(releasedMs) && Number.isFinite(scheduledMs) && releasedMs >= scheduledMs;
}

function scheduleKey(row: ScheduledCalendarRow) {
  const date = row.nextReleaseDate?.slice(0, 10) ?? "";
  return `${row.metricId}:${row.nextReleaseAt || date}`;
}
