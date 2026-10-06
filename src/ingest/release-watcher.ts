import { getEconomicCalendarRows } from "@/lib/economic-calendar-db";
import { getSourceConfig } from "./source-registry";

function sourceTimeZone(metricId: string) {
  if (metricId.startsWith("us-")) return "America/New_York";
  if (metricId.startsWith("uk-")) return "Europe/London";
  if (metricId.startsWith("ea-")) return "Europe/Brussels";
  return "UTC";
}

function localDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function getDueMetricIds(now = new Date()) {
  const rows = await getEconomicCalendarRows();
  return [...new Set(rows
    .filter((row) => row.metricId && getSourceConfig(row.metricId))
    .filter((row) => {
      if (row.nextReleaseAt) {
        const t = Date.parse(row.nextReleaseAt);
        return Number.isFinite(t) && now.getTime() >= t;
      }
      if (!row.nextReleaseDate) return false;
      return localDate(now, sourceTimeZone(row.metricId)) >= row.nextReleaseDate.slice(0, 10);
    })
    .map((row) => row.metricId))];
}
