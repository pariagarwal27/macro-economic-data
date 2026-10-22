import assert from "node:assert/strict";
import test from "node:test";
import { getDashboardCalendarMetrics } from "./dashboard-calendar-metrics";

test("release diary includes only intended UK inflation cards and labels their YoY and MoM releases", () => {
  const ukMetrics = getDashboardCalendarMetrics().filter(metric => metric.region === "UK");
  const ukById = new Map(ukMetrics.map(metric => [metric.id, metric]));

  for (const hiddenId of ["uk-food-cpi-yoy", "uk-food-cpi-mom", "uk-goods-cpi-yoy", "uk-goods-cpi-mom", "uk-housing-cpi-yoy", "uk-housing-cpih-mom"]) {
    assert.equal(ukById.has(hiddenId), false, `${hiddenId} should not appear in the Release Diary`);
  }

  for (const [metricId, expectedName] of [
    ["uk-cpi-yoy", "CPI YoY"],
    ["uk-cpi-mom", "CPI MoM"],
    ["uk-cpih-yoy", "CPIH YoY"],
    ["uk-cpih-mom", "CPIH MoM"],
    ["uk-core-cpi-yoy", "Core Inflation YoY"],
    ["uk-core-cpi-mom", "Core Inflation MoM"],
    ["uk-services-cpi-yoy", "Services Inflation YoY"],
    ["uk-services-cpi-mom", "Services Inflation MoM"],
    ["uk-ppi-output-yoy", "Producer Price Index YoY"],
    ["uk-ppi-output-mom", "Producer Price Index MoM"],
  ]) {
    assert.equal(ukById.get(metricId)?.name, expectedName, `${metricId} should be labeled with its measure`);
  }
});

test("release diary omits chart-only metric series", () => {
  const metricIds = new Set(getDashboardCalendarMetrics().map(metric => metric.id));
  assert.equal(metricIds.has("uk-retail-sales-total-yoy"), false);
});

test("release diary lists PCE rates instead of PCE price index levels", () => {
  const metrics = getDashboardCalendarMetrics();
  const byId = new Map(metrics.map(metric => [metric.id, metric]));

  for (const id of ["us-pce-mom", "us-pce-yoy", "us-core-pce-yoy", "us-core-pce-mom"]) {
    assert.ok(byId.has(id), `${id} should appear in the Release Diary`);
  }
  assert.equal(byId.get("us-pce-mom")?.name, "PCE (Headline) MoM");
  assert.equal(byId.get("us-pce-yoy")?.name, "PCE (Headline) YoY");
  assert.equal(byId.get("us-core-pce-yoy")?.name, "PCE (Core) YoY");
  assert.equal(byId.get("us-core-pce-mom")?.name, "PCE (Core) MoM");
});
