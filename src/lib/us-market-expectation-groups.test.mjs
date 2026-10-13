import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTATION_CHART_GROUPS } from "./expectation-chart-groups.ts";

test("US market-based charts show 5Y separately and pair 5Y5Y with 10Y", () => {
  assert.deepEqual(
    EXPECTATION_CHART_GROUPS["us-inflation-expectations-market"].map(group => group.series.map(item => item.id)),
    [
      ["us-breakeven-5y"],
      ["us-5y5y-forward", "us-breakeven-10y"],
    ],
  );
});
