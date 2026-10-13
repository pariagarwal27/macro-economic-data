import assert from "node:assert/strict";
import test from "node:test";

test("opening an expectation reading targets only that metric", async () => {
  const { createExpectationMetricSelection } = await import("./expectation-selection");

  assert.deepEqual(createExpectationMetricSelection("us-nyfed-sce-1y"), {
    metricId: "us-nyfed-sce-1y",
    children: [],
  });
});
