import { METRICS } from "../src/catalog/metrics";
import { SOURCE_REGISTRY, assertRegistryIsValid } from "../src/ingest/source-registry";
import { getEconomicCalendarRows } from "../src/lib/economic-calendar-db";

async function main() {
  assertRegistryIsValid();

  const catalog = new Set(METRICS.map((m) => m.id));
  const registry = new Set(SOURCE_REGISTRY.map((m) => m.metricId));
  const missing = [...catalog].filter((id) => !registry.has(id));
  const duplicates = SOURCE_REGISTRY.length - registry.size;

  const calendar = await getEconomicCalendarRows();
  const calendarIds = new Set(calendar.map((r) => r.metricId).filter(Boolean));
  const noCalendar = [...catalog].filter((id) => !calendarIds.has(id));

  const counts = SOURCE_REGISTRY.reduce<Record<string, number>>((acc, row) => {
    acc[row.source] = (acc[row.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    metrics: METRICS.length,
    registry: SOURCE_REGISTRY.length,
    duplicateRegistryEntries: duplicates,
    missingRegistryEntries: missing,
    calendarMetrics: calendarIds.size,
    metricsWithoutCalendarEntry: noCalendar,
    registryBySource: counts,
  }, null, 2));

  if (missing.length || duplicates) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
