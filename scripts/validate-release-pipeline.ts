import { METRICS } from "../src/catalog/metrics";
import { SOURCE_REGISTRY, assertRegistryIsValid, isUsCpiMetric } from "../src/ingest/source-registry";
import { getEconomicCalendarRows } from "../src/lib/economic-calendar-db";
import { LIVE_MAP } from "../src/catalog/live-map";
import { DASHBOARD } from "../src/components/macro-ui-hierarchy";
import { cpiUnderlyingScheduleRows } from "../src/ingest/cpi-release-schedule";

const UNDERLYING_CPI = [
  "us-sticky-cpi", "us-core-sticky-cpi", "us-flexible-cpi",
  "us-cleveland-median-cpi", "us-cleveland-trimmed-cpi",
];

async function main() {
  assertRegistryIsValid();

  const catalog = new Set(METRICS.map((m) => m.id));
  const registry = new Set(SOURCE_REGISTRY.map((m) => m.metricId));
  const intentionallyUnrouted = [...catalog].filter((id) => !registry.has(id) && isUsCpiMetric(id));
  const missing = [...catalog].filter((id) => !registry.has(id) && !isUsCpiMetric(id));
  const duplicates = SOURCE_REGISTRY.length - registry.size;

  const calendar = await getEconomicCalendarRows();
  const calendarIds = new Set(calendar.map((r) => r.metricId).filter(Boolean));
  const noCalendar = [...catalog].filter((id) => !calendarIds.has(id));

  const counts = SOURCE_REGISTRY.reduce<Record<string, number>>((acc, row) => {
    acc[row.source] = (acc[row.source] ?? 0) + 1;
    return acc;
  }, {});

  const badUnderlyingRoutes = UNDERLYING_CPI.filter(id => {
    const expected = id.startsWith("us-cleveland") ? "cleveland_cpi" : "atlanta_sticky";
    const route = LIVE_MAP[id];
    const metric = METRICS.find(item => item.id === id);
    const registryRow = SOURCE_REGISTRY.find(item => item.metricId === id);
    return route?.provider !== expected || metric?.source === "fred" || registryRow?.source === "fred";
  });
  const cpiCard = DASHBOARD.US.prices.find(spec => spec.id === "us-cpi-card");
  const missingUnderlyingUi = UNDERLYING_CPI.filter(id => !cpiCard?.chartMetricIds?.includes(id));
  const derivedScheduleCount = cpiUnderlyingScheduleRows({ nextReleaseDate: "2026-11-12", nextReleaseAt: null }).length;

  console.log(JSON.stringify({
    metrics: METRICS.length,
    registry: SOURCE_REGISTRY.length,
    duplicateRegistryEntries: duplicates,
    missingRegistryEntries: missing,
    intentionallyUnroutedCpiMetrics: intentionallyUnrouted,
    calendarMetrics: calendarIds.size,
    metricsWithoutCalendarEntry: noCalendar,
    registryBySource: counts,
    underlyingCpiMetrics: UNDERLYING_CPI.length,
    invalidUnderlyingOfficialRoutes: badUnderlyingRoutes,
    underlyingMetricsMissingFromUiRequest: missingUnderlyingUi,
    cpiLinkedUnderlyingCalendarRows: derivedScheduleCount,
  }, null, 2));

  if (missing.length || duplicates || badUnderlyingRoutes.length || missingUnderlyingUi.length || derivedScheduleCount !== 5) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
