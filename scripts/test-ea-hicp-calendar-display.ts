import assert from "node:assert/strict";
import { buildEconomicCalendar } from "../src/lib/economic-calendar-view";
import { METRICS } from "../src/catalog/metrics";

const ids = [
  "ea-core-hicp-yoy",
  "ea-core-hicp-mom",
  "ea-hicp-yoy",
  "ea-hicp-mom",
  "ea-services-hicp-mom",
  "ea-services-hicp-yoy",
];
const schedule = ids.map(metricId => ({
  metricId,
  metricName: metricId,
  nextReleaseDate: "2026-10-16",
  nextReleaseAt: "2026-10-16T11:00:00+02:00",
  status: "scheduled",
  source: "Eurostat",
  family: null,
  officialSource: "https://ec.europa.eu/eurostat",
  officialEvidence: null,
  updatedAt: "2026-10-15T12:00:00Z",
}));
const payload = buildEconomicCalendar(schedule, [], METRICS, new Date("2026-10-16T08:30:00Z"));
const euroAreaReleases = payload.todayEvents.filter(event => ids.includes(event.metricId));

assert.deepEqual(euroAreaReleases.map(event => [event.metricId, event.metricName]), [
  ["ea-core-hicp-yoy", "Core HICP YoY"],
  ["ea-core-hicp-mom", "Core HICP MoM"],
  ["ea-hicp-yoy", "Headline HICP YoY"],
  ["ea-hicp-mom", "Headline HICP MoM"],
  ["ea-services-hicp-mom", "Services HICP MoM"],
  ["ea-services-hicp-yoy", "Services HICP YoY"],
]);
console.log("Euro Area HICP diary names and paired ordering passed");
