import assert from "node:assert/strict";
import { buildEconomicCalendar } from "../src/lib/economic-calendar-view";
import { METRICS } from "../src/catalog/metrics";

const row = (metricId: string, date: string | null, at: string | null, status: string | null = null) => ({
  metricId, metricName: metricId, nextReleaseDate: date, nextReleaseAt: at, status,
  source: "Eurostat", family: null, officialSource: "https://example.org/schedule", officialEvidence: null, updatedAt: "2026-10-06T10:00:00Z",
});
const payload = buildEconomicCalendar([
  row("us-cpi", "2026-10-07", "2026-10-07T08:30:00-04:00"),
  row("ea-ppi-yoy", "2026-10-06", null),
  row("ea-inflation-comp-1y", "2026-10-07", null, "daily_series"),
  row("us-gdp-now", null, null, "not_announced"),
], [{ metricId: "us-cpi", releasedAt: "2026-10-06T15:00:00Z", value: 3, expectedValue: null, priorPeriodValue: null }], METRICS, new Date("2026-10-06T12:00:00Z"));
assert.equal(payload.allEvents.length, METRICS.length, "Every catalog metric must be visible in the complete schedule");
assert.equal(payload.allEvents.find(item => item.metricId === "us-cpi")?.status, "upcoming", "Yesterday's ingestion must not mark a future scheduled event released");
assert.equal(payload.todayEvents.find(item => item.metricId === "ea-ppi-yoy")?.scheduledTime, null, "Date-only rows must not inherit a blanket Eurostat time");
assert.ok(!Object.values(payload.week).flat().some(item => item.metricId === "ea-inflation-comp-1y"), "Daily data must not masquerade as an announced event");
assert.equal(payload.allEvents.find(item => item.metricId === "ea-inflation-comp-1y")?.scheduleType, "daily");
assert.equal(payload.allEvents.find(item => item.metricId === "us-gdp-now")?.scheduleType, "unannounced");
const overnight = buildEconomicCalendar([row("us-cpi", "2026-10-06", "2026-10-06T20:30:00-04:00")], [], METRICS, new Date("2026-10-06T12:00:00Z"));
assert.equal(overnight.allEvents.find(item => item.metricId === "us-cpi")?.scheduledDate, "2026-10-07", "Date and time must both use the display timezone");
const naive = buildEconomicCalendar([row("us-cpi", "2026-10-06", "2026-10-06T08:30:00")], [], METRICS, new Date("2026-10-06T12:00:00Z"));
assert.equal(naive.todayEvents[0].scheduledTime, null, "Unknown source timezone must not be interpreted as server local time");
console.log("Calendar coverage, honest time labels, event matching and timezone rollover passed");
const late = buildEconomicCalendar([row('us-cpi', '2026-10-06', '2026-10-06T08:30:00-04:00')], [{metricId:'us-cpi', releasedAt:'2026-10-07T01:00:00Z',value:3.1,expectedValue:null,priorPeriodValue:3}], METRICS, new Date('2026-10-07T12:00:00Z'));
assert.equal(late.allEvents.find(event=>event.metricId==='us-cpi')?.status,'released','Successful ingestion after midnight must complete the scheduled event');
const deadline = buildEconomicCalendar([{...row('us-sticky-cpi','2026-10-14',null), releaseDeadlineAt:'2026-10-14T11:00:00-04:00', releaseTimeKind:'by' as const}],[],METRICS,new Date('2026-10-07T12:00:00Z'));
assert.equal(deadline.allEvents.find(event=>event.metricId==='us-sticky-cpi')?.scheduledTimeLabel,'By 16:00','A deadline must be converted and clearly qualified');
assert.equal(deadline.allEvents.find(event=>event.metricId==='us-sticky-cpi')?.scheduledAt,null,'A deadline must never masquerade as an exact timestamp');
const previous = row('us-cpi','2026-10-06','2026-10-06T08:30:00-04:00');
const storedRelease = {id:42, metricId:'us-cpi',releasedAt:'2026-10-01T00:00:00Z',value:3.2,expectedValue:null,priorPeriodValue:3};
const refreshed = buildEconomicCalendar([row('us-cpi','2026-11-10','2026-11-10T08:30:00-05:00')],[storedRelease],METRICS,new Date('2026-10-07T12:00:00Z'),{history:[previous],completions:[{metricId:'us-cpi',scheduledAt:previous.nextReleaseAt!,processedAt:'2026-10-07T01:00:00Z',releaseId:42}]});
assert.equal(refreshed.week['2026-10-06'].find(event=>event.metricId==='us-cpi')?.status,'released','Weekly refresh must preserve completed earlier events');
assert.equal(refreshed.week['2026-10-06'].find(event=>event.metricId==='us-cpi')?.actual,3.2,'Use the specific committed release even if its provider timestamp predates ingestion');
assert.equal(refreshed.allEvents.find(event=>event.metricId==='us-cpi')?.status,'upcoming','Completion of the previous event must not release next month');
console.log('Delayed ingestion, deadline labels, durable completion IDs, and event history passed');
