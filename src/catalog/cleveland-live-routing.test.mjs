import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_MAP } from "./live-map.ts";

test("Cleveland Fed model expectation horizons route to the official Cleveland provider", () => {
  const expectedSeries = {
    "us-cleveland-exp-inf-1y": "EXPINF1YR",
    "us-cleveland-exp-inf-2y": "EXPINF2YR",
    "us-cleveland-exp-inf-3y": "EXPINF3YR",
    "us-cleveland-exp-inf-5y": "EXPINF5YR",
    "us-cleveland-exp-inf-10y": "EXPINF10YR",
    "us-cleveland-exp-inf-30y": "EXPINF30YR",
  };

  for (const [metricId, seriesId] of Object.entries(expectedSeries)) {
    assert.deepEqual(LIVE_MAP[metricId], {
      provider: "cleveland",
      seriesId,
    });
  }
});
