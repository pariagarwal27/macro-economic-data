import type { ScheduledCalendarRow } from "@/lib/economic-calendar-db";
import { US_PPI_RELEASE_PAIRS, US_PPI_METRIC_IDS } from '../catalog/us-ppi.mjs';

function sourceTimeZone(metricId: string) {
  if (metricId.startsWith("us-")) return "America/New_York";
  if (metricId.startsWith("uk-")) return "Europe/London";
  if (metricId.startsWith("ea-")) return "Europe/Brussels";
  if (["de-", "fr-", "it-", "es-"].some(prefix => metricId.startsWith(prefix))) return "Europe/Berlin";
  return "UTC";
}

function dateInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const EA_HICP_COMPONENT_RELEASE_PEERS: Readonly<Record<string, string>> = {
  "ea-food-hicp-yoy": "ea-food-hicp-mom",
  "ea-energy-hicp-yoy": "ea-energy-hicp-mom",
  "ea-goods-hicp-yoy": "ea-goods-hicp-mom",
};

export const PPI_RELEASE_PEERS: Readonly<Record<string, string>> = {
  ...US_PPI_RELEASE_PAIRS,
  "us-ppi-final-demand": "us-ppi-final-demand-mom",
  "us-ppi-core": "us-ppi-core-mom",
  "uk-ppi-output-yoy": "uk-ppi-output-mom",
  "uk-ppi-input-yoy": "uk-ppi-input-mom",
  "uk-ppi-import-yoy": "uk-ppi-import-mom",
  "uk-ppi-export-yoy": "uk-ppi-export-mom",
  "uk-ppi-food-beverages-tobacco-yoy": "uk-ppi-food-beverages-tobacco-mom",
  "uk-ppi-alcohol-tobacco-yoy": "uk-ppi-alcohol-tobacco-mom",
  "uk-ppi-textiles-yoy": "uk-ppi-textiles-mom",
  "uk-ppi-paper-yoy": "uk-ppi-paper-mom",
  "uk-ppi-petroleum-yoy": "uk-ppi-petroleum-mom",
  "uk-ppi-chemicals-yoy": "uk-ppi-chemicals-mom",
  "uk-ppi-metals-machinery-yoy": "uk-ppi-metals-machinery-mom",
  "uk-ppi-computers-electronics-yoy": "uk-ppi-computers-electronics-mom",
  "uk-ppi-vehicles-yoy": "uk-ppi-vehicles-mom",
  "uk-ppi-input-manufactured-yoy": "uk-ppi-input-manufactured-mom",
  "uk-ppi-input-fuel-yoy": "uk-ppi-input-fuel-mom",
  "uk-ppi-input-petroleum-ores-yoy": "uk-ppi-input-petroleum-ores-mom",
  "uk-ppi-input-beverages-tobacco-yoy": "uk-ppi-input-beverages-tobacco-mom",
  "uk-ppi-input-other-yoy": "uk-ppi-input-other-mom",
  "uk-ppi-input-chemicals-yoy": "uk-ppi-input-chemicals-mom",
  "uk-ppi-input-metals-yoy": "uk-ppi-input-metals-mom",
  "uk-ppi-input-equipment-yoy": "uk-ppi-input-equipment-mom",
  "uk-ppi-input-domestic-food-yoy": "uk-ppi-input-domestic-food-mom",
  "uk-ppi-input-imported-food-yoy": "uk-ppi-input-imported-food-mom",
  "ea-ppi-yoy": "ea-ppi-mom",
  "us-ppi-goods-yoy": "us-ppi-goods-mom",
  "us-ppi-foods-yoy": "us-ppi-foods-mom",
  "us-ppi-energy-yoy": "us-ppi-energy-mom",
  "us-ppi-goods-ex-food-energy-yoy": "us-ppi-goods-ex-food-energy-mom",
  "us-ppi-services-yoy": "us-ppi-services-mom",
  "us-ppi-services-ex-trade-yoy": "us-ppi-services-ex-trade-mom",
  "us-ppi-construction-yoy": "us-ppi-construction-mom",
  "us-ppi-final-demand-trade-yoy": "us-ppi-final-demand-trade-mom",
  "us-ppi-final-demand-transport-yoy": "us-ppi-final-demand-transport-mom",
  "us-ppi-intermediate-stage-1-yoy": "us-ppi-intermediate-stage-1-mom",
  "us-ppi-intermediate-stage-2-yoy": "us-ppi-intermediate-stage-2-mom",
  "us-ppi-intermediate-stage-3-yoy": "us-ppi-intermediate-stage-3-mom",
  "us-ppi-intermediate-stage-4-yoy": "us-ppi-intermediate-stage-4-mom",
  "us-ppi-intermediate-processed-goods-yoy": "us-ppi-intermediate-processed-goods-mom",
  "us-ppi-intermediate-unprocessed-goods-yoy": "us-ppi-intermediate-unprocessed-goods-mom",
  "us-ppi-intermediate-services-yoy": "us-ppi-intermediate-services-mom",
  "us-ppi-intermediate-construction-yoy": "us-ppi-intermediate-construction-mom",
  "ea-ppi-capital-goods-yoy": "ea-ppi-capital-goods-mom",
  "ea-ppi-intermediate-goods-yoy": "ea-ppi-intermediate-goods-mom",
  "ea-ppi-durable-consumer-goods-yoy": "ea-ppi-durable-consumer-goods-mom",
  "ea-ppi-non-durable-consumer-goods-yoy": "ea-ppi-non-durable-consumer-goods-mom",
  "ea-ppi-energy-yoy": "ea-ppi-energy-mom",
};

/** True only on the scheduled release's local calendar day. */
export function inheritUsPpiReleaseSchedules(rows: readonly ScheduledCalendarRow[]) {
  const headlineRows = rows.filter(row => row.metricId === 'us-ppi-final-demand' && row.nextReleaseDate);
  const existing = new Set(rows.map(scheduleKey));
  return headlineRows.flatMap(row => US_PPI_METRIC_IDS.map(metricId => ({ ...row, metricId, metricName: metricId })))
    .filter(row => !existing.has(scheduleKey(row)));
}

/** True only on the scheduled release's local calendar day. */
export function isOnScheduledReleaseDay(metricId: string, scheduledAt: string, now: Date) {
  const timeZone = sourceTimeZone(metricId);
  const dateOnly = scheduledAt.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  const scheduledMs = Date.parse(scheduledAt);
  if (!dateOnly && !Number.isFinite(scheduledMs)) return false;
  const scheduledDate = dateOnly ?? dateInTimeZone(new Date(scheduledMs), timeZone);
  return dateInTimeZone(now, timeZone) === scheduledDate;
}

/** Give separately published measure series the same official release schedule as their paired YoY series. */
export function inheritReleaseSchedules(
  rows: readonly ScheduledCalendarRow[],
  pairs: Readonly<Record<string, string>>,
) {
  const existing = new Set(rows.map(scheduleKey));
  return Object.entries(pairs).flatMap(([sourceMetricId, pairedMetricId]) =>
    rows
      .filter(row => row.metricId === sourceMetricId && row.nextReleaseDate)
      .map(row => ({ ...row, metricId: pairedMetricId, metricName: pairedMetricId }))
      .filter(row => !existing.has(scheduleKey(row))),
  );
}

export function retryableHistoricalSchedules(
  currentRows: readonly ScheduledCalendarRow[],
  historyRows: readonly ScheduledCalendarRow[],
  now: Date,
): ScheduledCalendarRow[] {
  const activeKeys = new Set(currentRows.map(scheduleKey));
  return historyRows.filter(row => {
    if (!row.metricId || !row.nextReleaseDate) return false;
    if (activeKeys.has(scheduleKey(row))) return false;
    const scheduledAt = row.nextReleaseAt && Number.isFinite(Date.parse(row.nextReleaseAt))
      ? Date.parse(row.nextReleaseAt)
      : Date.parse(`${row.nextReleaseDate.slice(0, 10)}T23:59:59.999Z`);
    const ageMs = now.getTime() - scheduledAt;
    return Number.isFinite(scheduledAt) && ageMs >= 0 && ageMs <= 3 * 86_400_000;
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
