import assert from "node:assert/strict";
import test from "node:test";
import type { MetricDef } from "@/catalog/metrics";
import { buildEconomicCalendar, filterScheduledCalendarEvents, isWithinLastSevenCalendarDays } from "./economic-calendar-view";

test("calendar diary filters out daily/hourly series and optionally limits releases to one country", () => {
  const events = [
    { region: "US", scheduleType: "scheduled", metricId: "us-cpi" },
    { region: "UK", scheduleType: "scheduled", metricId: "uk-gdp" },
    { region: "EA", scheduleType: "daily", metricId: "ea-breakeven" },
    { region: "US", scheduleType: "hourly", metricId: "us-claims" },
    { region: "UK", scheduleType: "unannounced", metricId: "uk-other" },
  ];

  assert.deepEqual(filterScheduledCalendarEvents(events, "US").map(event => event.metricId), ["us-cpi"]);
  assert.deepEqual(filterScheduledCalendarEvents(events, "ALL").map(event => event.metricId), ["us-cpi", "uk-gdp"]);
});

test("last seven days includes today and excludes earlier, future, and continuous series", () => {
  assert.equal(isWithinLastSevenCalendarDays("2026-10-06", "scheduled", "2026-10-12"), true);
  assert.equal(isWithinLastSevenCalendarDays("2026-10-05", "scheduled", "2026-10-12"), false);
  assert.equal(isWithinLastSevenCalendarDays("2026-10-13", "scheduled", "2026-10-12"), false);
  assert.equal(isWithinLastSevenCalendarDays(null, "daily", "2026-10-12"), false);
});

test("released event uses the previous observation when the release omits priorPeriodValue", () => {
  const metric = {
    id: "us-cleveland-exp-inf-1y", region: "US", category: "inflation", subcategory: "expectations",
    name: "Cleveland 1Y", shortName: "Cleveland 1Y", description: "", source: "fred", seriesId: "SERIES",
    transform: "published_rate", frequency: "monthly", unit: "percent", importance: "high",
    officialUrl: "", docsUrl: "", releaseName: "Cleveland Expectations",
  } as MetricDef;
  const schedule = [{
    metricId: metric.id, metricName: metric.name, source: "FRED", family: "CLEVELAND",
    nextReleaseDate: "2026-10-07", nextReleaseAt: "2026-10-07T16:00:00Z", status: "success",
    officialSource: "", updatedAt: "2026-10-07T16:00:00Z",
  }];
  const result = buildEconomicCalendar(schedule, [{
    id: 4, metricId: metric.id, periodDate: "2026-09-01", releasedAt: "2026-10-07T16:00:00Z",
    value: 2.64, expectedValue: null, priorPeriodValue: null,
  }], [metric], new Date("2026-10-12T12:00:00Z"), {
    releaseHistory: new Map([[metric.id, [
      { periodDate: "2026-09-01", value: 2.64 },
      { periodDate: "2026-08-01", value: 2.39 },
    ]]]),
  });

  assert.equal(result.allEvents[0].previous, 2.39);
  assert.equal(result.allEvents[0].actual, 2.64);
  assert.equal(result.allEvents[0].status, "released");
  assert.equal(result.recentEvents.length, 1);
});
