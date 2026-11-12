import assert from "node:assert/strict";
import test from "node:test";
import { isOnScheduledReleaseDay } from "./release-schedule-retries";

test("missed Fed downloads remain eligible for seven days, without allowing early fetches", () => {
  for (const id of ["us-sticky-cpi", "us-core-sticky-cpi-mom", "us-cleveland-median-cpi", "us-cleveland-exp-inf-1y", "us-atlanta-bie-1y"]) {
    assert.equal(isOnScheduledReleaseDay(id, "2026-11-10", new Date("2026-11-09T18:00Z")), false);
    assert.equal(isOnScheduledReleaseDay(id, "2026-11-10", new Date("2026-11-12T18:00Z")), true);
    assert.equal(isOnScheduledReleaseDay(id, "2026-11-10", new Date("2026-11-18T18:00Z")), false);
  }
  assert.equal(isOnScheduledReleaseDay("us-nfp", "2026-11-10", new Date("2026-11-12T18:00Z")), false);
});
