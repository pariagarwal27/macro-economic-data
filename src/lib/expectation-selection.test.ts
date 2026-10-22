import assert from "node:assert/strict";
import test from "node:test";

test("opening an expectation reading targets only that metric", async () => {
  const { createExpectationMetricSelection } = await import("./expectation-selection");

  assert.deepEqual(createExpectationMetricSelection("us-nyfed-sce-1y"), {
    metricId: "us-nyfed-sce-1y",
    children: [],
  });
});

test("UK household wage expectations use DMP only and market charts use 5Y, not 10Y", async () => {
  const { DASHBOARD } = await import("../components/macro-ui-hierarchy");
  const expectations = DASHBOARD.UK.expectations;
  const wage = expectations.find(item => item.expectationGroup === "wage");
  const market = expectations.find(item => item.expectationGroup === "market");

  assert.equal(expectations.some(item => item.expectationGroup === "professional"), false);
  assert.deepEqual(wage?.chartMetricIds, ["uk-dmp-wage-exp-1y"]);
  assert.deepEqual(wage?.components?.map(component => component.metricId), ["uk-dmp-wage-exp-1y"]);
  assert.deepEqual(market?.chartMetricIds, [
    "uk-inflation-comp-1y",
    "uk-inflation-comp-5y5y",
    "uk-inflation-comp-5y",
  ]);
  assert.equal(market?.chartMetricIds?.includes("uk-inflation-comp-10y"), false);
});
