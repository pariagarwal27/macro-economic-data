import assert from "node:assert/strict";
import test from "node:test";
import { getPublishedExpectationReadings } from "./expectation-series.ts";

test("keeps UMich published expectation levels instead of deriving rates from the levels", () => {
  const result = getPublishedExpectationReadings([
    { date: "2026-03-01", value: 3.8 },
    { date: "2026-01-01", value: 4.8 },
    { date: "2026-02-01", value: 4.1 },
  ]);

  assert.deepEqual(result, [
    { date: "2026-01-01", value: 4.8 },
    { date: "2026-02-01", value: 4.1 },
    { date: "2026-03-01", value: 3.8 },
  ]);
  assert.equal(result.at(-1).value, 3.8);
  assert.equal(result.at(-2).value, 4.1);
});
