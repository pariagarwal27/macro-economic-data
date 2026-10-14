import assert from "node:assert/strict";
import test from "node:test";
import * as chartConfig from "./expectation-chart-groups.ts";

test("NY Fed overview keeps earnings in household finance and Atlanta wages in their own chart", () => {
  assert.ok(chartConfig.NYFED_OVERVIEW_CHART_GROUPS, "overview chart groups are exported for the UI and regression tests");
  const groups = chartConfig.NYFED_OVERVIEW_CHART_GROUPS;
  assert.deepEqual(groups.household.ids, [
    "us-nyfed-sce-finance-income-1y",
    "us-nyfed-sce-finance-spending-1y",
    "us-nyfed-sce-labor-earnings-1y",
  ]);
  assert.ok(!groups.household.ids.includes("us-nyfed-sce-finance-tax-1y"));
  assert.deepEqual(groups.payGrowth.ids, ["us-atlanta-wage"]);
  assert.match(groups.payGrowth.title, /Atlanta Fed Wage Growth Tracker/);
  assert.equal(Object.keys(groups)[0], "payGrowth", "Atlanta wages appear before the NY Fed overview charts");
  assert.equal(chartConfig.NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-atlanta-wage"], undefined, "the single-series Atlanta chart uses one left axis");
  assert.equal(chartConfig.NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-labor-unemployment-1y"], "right");
});
