import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPceCalendarActuals } from "./pce-calendar";
import { buildEconomicCalendar } from "./economic-calendar-view";
import { METRICS } from "@/catalog/metrics";

test("calendar advances PCE rates to the released index period despite a stale completed rate row", () => {
  const catalog = METRICS.filter(metric => metric.id === "us-core-pce-mom");
  const scheduledAt = "2026-10-29T12:30:00Z";
  const actuals = [
    { id: 1, metricId: "us-core-pce-mom", periodDate: "2026-08-01", releasedAt: "2026-10-29T12:30:06Z", value: 0.408, expectedValue: null, priorPeriodValue: 0.1262 },
    { id: 2, metricId: "us-core-pce", periodDate: "2026-09-01", releasedAt: "2026-10-29T12:30:14Z", value: 130.902, expectedValue: null, priorPeriodValue: 130.489 },
  ];
  const completions = actuals.map(actual => ({ metricId: actual.metricId, scheduledAt, processedAt: actual.releasedAt, releaseId: actual.id }));
  const histories = new Map([["us-core-pce", [{ date: "2026-07-01", value: 130.148 }, { date: "2026-08-01", value: 130.489 }, { date: "2026-09-01", value: 130.902 }]]]);
  const schedule = [{ metricId: "us-core-pce-mom", metricName: "Core PCE MoM", source: "BEA", family: "PCE", nextReleaseDate: "2026-10-29", nextReleaseAt: scheduledAt, status: "success", officialSource: "", updatedAt: scheduledAt }];
  const stale = buildEconomicCalendar(schedule, actuals.slice(0, 1), catalog, new Date("2026-10-29T13:00:00Z"), { completions });
  assert.equal(stale.todayEvents[0].status, "pending");
  const canonical = canonicalPceCalendarActuals(actuals, completions, histories);
  const result = buildEconomicCalendar(schedule, canonical.actuals, catalog, new Date("2026-10-29T13:00:00Z"), { completions: canonical.completions });
  const event = result.todayEvents[0];
  assert.equal(event.status, "released");
  assert.ok(Math.abs(event.actual! - (130.902 / 130.489 - 1) * 100) < 1e-10);
  assert.ok(Math.abs(event.previous! - (130.489 / 130.148 - 1) * 100) < 1e-10);
  assert.equal(event.actualReleasedAt, "2026-10-29T12:30:14Z");
});
