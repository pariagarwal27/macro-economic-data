import assert from "node:assert/strict";
import test from "node:test";
import { NYFED_EXPECTATION_AXIS_BY_METRIC_ID } from "./expectation-chart-groups.ts";

test("NY Fed comparison charts assign series to intentional axes", () => {
  assert.deepEqual(
    {
      income: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-finance-income-1y"],
      spending: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-finance-spending-1y"],
      earnings: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-labor-earnings-1y"],
      wageTracker: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-atlanta-wage"],
      jobSeparation: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-labor-job-separation-1y"],
      jobFinding: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-labor-job-finding-1y"],
      unemployment: NYFED_EXPECTATION_AXIS_BY_METRIC_ID["us-nyfed-sce-labor-unemployment-1y"],
    },
    {
      income: "left",
      spending: "right",
      earnings: "left",
      wageTracker: "left",
      jobSeparation: "left",
      jobFinding: "right",
      unemployment: "left",
    },
  );
});
