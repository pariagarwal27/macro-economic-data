import assert from "node:assert/strict";
import test from "node:test";
import { expectedPcePeriod, pceRate } from "./pce-release";

test("August PCE uses a consistent index vintage instead of the stale 0.408 rate", () => {
  const metrics = {
    "us-core-pce": { meta: { unit: "index" }, history: [{ date: "2026-07-01", value: 130.148 }, { date: "2026-08-01", value: 130.489 }, { date: "2026-09-01", value: 130.902 }] },
    "us-core-pce-mom": { meta: { unit: "percent" }, history: [{ date: "2026-08-01", value: 0.408 }] },
  };
  assert.ok(Math.abs(pceRate(metrics, true, "2026-08", "mom")! - (130.489 / 130.148 - 1) * 100) < 1e-10);
  assert.ok(Math.abs(pceRate(metrics, true, "2026-09", "mom")! - (130.902 / 130.489 - 1) * 100) < 1e-10);
  assert.equal(expectedPcePeriod("2026-10-29T08:30:00-04:00"), "2026-09-01");
  assert.equal(expectedPcePeriod("2027-01-29T08:30:00-05:00"), "2026-12-01");
});
