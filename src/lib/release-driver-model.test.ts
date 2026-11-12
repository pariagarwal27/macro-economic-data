import assert from "node:assert/strict";
import test from "node:test";
import { calendarWindow, finiteMedian, rankedDrivers, classifyCpiDriver, disjointNodes } from "./release-driver-model";
import { releaseCardTarget } from "./release-card-targets";

test("six releases span year boundaries and preserve actual calendar months", () => {
  assert.deepEqual(calendarWindow("2026-02"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
});
test("median excludes gaps rather than turning missing observations into zero", () => {
  assert.equal(finiteMedian([null, 0.08, 0.10, 0.11, 0.13, 0.18]), 0.11);
  assert.equal(finiteMedian([0.08, 0.10, 0.11, 0.13, 0.15, 0.18]), 0.12);
  assert.equal(finiteMedian([null, null]), null);
});
test("negative offsets rank by magnitude and unknown contributions sort last", () => {
  const rows = [{ id: "a", label: "A", current: 0.05, rate: 10 }, { id: "b", label: "B", current: -0.1, rate: -2 }, { id: "c", label: "C", current: null, rate: 100 }];
  assert.deepEqual(rankedDrivers(rows, true).map(row => row.id), ["b", "a", "c"]);
});
test("classifications are sourced US CPI mappings, not geographic guesses", () => {
  assert.equal(classifyCpiDriver("us-cpi-medical-commodities"), "sticky");
  assert.equal(classifyCpiDriver("us-cpi-new-vehicles"), "flexible");
  assert.equal(classifyCpiDriver("us-cpi-shelter"), "sticky");
  assert.equal(classifyCpiDriver("us-cpi-food"), "flexible");
  assert.equal(classifyCpiDriver("uk-food-cpi-yoy"), "unclassified");
  assert.equal(classifyCpiDriver("us-pce-healthcare"), "unclassified");
});
test("nested component selection does not double-count an aggregate and its children", () => {
  assert.deepEqual(disjointNodes([{ id: "goods", metricId: "goods", children: [{ id: "cars", metricId: "cars" }, { id: "missing" }] }]).map(row => row.metricId), ["cars"]);
  assert.deepEqual(disjointNodes([{ id: "goods", metricId: "goods", children: [{ id: "unmapped" }] }]).map(row => row.metricId), ["goods"]);
});
test("standalone aliases use the same card families without changing unrelated metrics", () => {
  assert.equal(releaseCardTarget("us-core-cpi-mom")?.rootId, "us-cpi-core");
  assert.equal(releaseCardTarget("uk-cpih-mom")?.rootId, "uk-cpih-yoy");
  assert.equal(releaseCardTarget("ea-core-hicp-yoy")?.region, "EA");
  assert.equal(releaseCardTarget("us-retail-sales")?.kind, "retail");
  assert.equal(releaseCardTarget("us-gdp-real"), null);
});
