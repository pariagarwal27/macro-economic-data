import assert from "node:assert/strict";
import { isOnScheduledReleaseDay, retryableHistoricalSchedules, wasRecordedAfterSchedule } from "../src/ingest/release-schedule-retries.ts";

const now = new Date("2026-10-15T12:00:00Z");
const oldRelease = { metricId: "us-cleveland-exp-inf-1y", nextReleaseDate: "2026-10-14", nextReleaseAt: null };
const nextRelease = { ...oldRelease, nextReleaseDate: "2026-11-10" };

assert.deepEqual(
  retryableHistoricalSchedules([nextRelease], [oldRelease], now).map(row => row.nextReleaseDate),
  [],
  "a missed release from yesterday must not be retried today",
);
assert.deepEqual(
  retryableHistoricalSchedules([oldRelease], [oldRelease], now),
  [],
  "the currently active release schedule is not duplicated from history",
);
assert.deepEqual(retryableHistoricalSchedules([nextRelease], [{ ...oldRelease, nextReleaseDate: "2026-10-15" }], now).map(row => row.nextReleaseDate), ["2026-10-15"], "a historical release is retryable on its own local release day");
assert.equal(isOnScheduledReleaseDay("us-cpi", "2026-10-14T12:30:00.000Z", now), false, "the retry loop must stop after the US release day ends");
assert.equal(isOnScheduledReleaseDay("us-cpi", "2026-10-15T08:30:00-04:00", new Date("2026-10-15T13:00:00Z")), true, "scheduled retries continue during the release's local calendar day");
assert.equal(wasRecordedAfterSchedule("2026-10-15T07:47:03Z", "2026-10-14"), true);
assert.equal(wasRecordedAfterSchedule("2026-10-13T07:47:03Z", "2026-10-14"), false);
console.log("release schedule retry checks passed");
