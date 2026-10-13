import assert from "node:assert/strict";
import test from "node:test";
import type { MetricDef } from "@/catalog/metrics";
import { calendarMetricName, shouldShowCalendarMetric } from "./economic-calendar-metrics";

const metric = (overrides: Partial<MetricDef>): MetricDef => ({
  id: "metric", region: "US", category: "inflation", subcategory: "prices",
  name: "Consumer Price Index", shortName: "CPI", description: "", source: "bls",
  seriesId: "SERIES", transform: "level", frequency: "monthly", unit: "index",
  importance: "high", officialUrl: "", docsUrl: "", releaseName: "CPI", ...overrides,
});

test("index series are hidden when the same published series has a rate measure", () => {
  const level = metric({ id: "us-cpi", seriesId: "CUSR0000SA0" });
  const rate = metric({ id: "us-cpi-mom", seriesId: "CUSR0000SA0", transform: "pct_change_mom", unit: "percent" });
  assert.equal(shouldShowCalendarMetric(level, [level, rate]), false);
  assert.equal(shouldShowCalendarMetric(rate, [level, rate]), true);
  assert.equal(shouldShowCalendarMetric(metric({ frequency: "daily" }), [metric({ frequency: "daily" })]), true);
});

test("calendar names distinguish the available change period", () => {
  assert.equal(calendarMetricName(metric({ name: "Core CPI", transform: "pct_change_mom" })), "Core CPI MoM");
  assert.equal(calendarMetricName(metric({ name: "Core CPI YoY", transform: "pct_change_yoy" })), "Core CPI YoY");
  assert.equal(calendarMetricName(metric({ name: "Cleveland Fed Expected Inflation (1-Year)", unit: "percent" })), "Cleveland Fed Expected Inflation (1-Year)");
  assert.equal(calendarMetricName(metric({ name: "Daily CPI estimate", frequency: "daily", transform: "pct_change_yoy" })), "Daily CPI estimate");
});
