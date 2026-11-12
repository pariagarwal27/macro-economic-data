import type { ScheduledCalendarRow } from "@/lib/economic-calendar-db";

const EUROSTAT_NATIONAL_ACCOUNTS_URL = "https://ec.europa.eu/eurostat/web/national-accounts/methodology/european-accounts/main-aggregates";

/** Official Eurostat Q3 2026 dates, retained as a fallback if calendar refresh misses an event. */
const Q3_2026_GDP_RELEASES = [
  { date: "2026-10-30", at: "2026-10-30T11:00:00+01:00", evidence: "Preliminary flash estimate GDP - EU and euro area, Q3/2026" },
  { date: "2026-11-13", at: "2026-11-13T11:00:00+01:00", evidence: "Flash estimate GDP and employment - EU and euro area, Q3/2026" },
  { date: "2026-12-07", at: "2026-12-07T11:00:00+01:00", evidence: "GDP main aggregates and employment, Q3/2026" },
] as const;

/** Schedule-only rows. They never contain data values and expire outside the release date. */
export function eurostatGdpScheduleFallbacks(): ScheduledCalendarRow[] {
  return Q3_2026_GDP_RELEASES.flatMap(release => ["ea-gdp-qoq", "ea-gdp-yoy"].map(metricId => ({
    metricId,
    metricName: metricId === "ea-gdp-qoq" ? "Euro Area Real GDP QoQ" : "Euro Area Real GDP YoY",
    source: "Eurostat",
    family: "GDP_EMPLOYMENT",
    nextReleaseDate: release.date,
    nextReleaseAt: release.at,
    status: "official_date",
    officialSource: EUROSTAT_NATIONAL_ACCOUNTS_URL,
    officialEvidence: release.evidence,
    updatedAt: null,
  })));
}

export function missingEurostatGdpScheduleFallbacks(existingRows: readonly Pick<ScheduledCalendarRow, "metricId" | "nextReleaseDate">[]) {
  const existing = new Set(existingRows.map(row => `${row.metricId}:${row.nextReleaseDate?.slice(0, 10) ?? ""}`));
  return eurostatGdpScheduleFallbacks().filter(row => !existing.has(`${row.metricId}:${row.nextReleaseDate}`));
}
