import assert from "node:assert/strict";
import { retryableHistoricalSchedules, wasRecordedAfterSchedule } from "../src/ingest/release-schedule-retries.ts";

const now = new Date("2026-10-15T12:00:00Z");
const oldRelease = { metricId: "us-cleveland-exp-inf-1y", nextReleaseDate: "2026-10-14", nextReleaseAt: null };
const nextRelease = { ...oldRelease, nextReleaseDate: "2026-11-10" };

assert.deepEqual(
  retryableHistoricalSchedules([nextRelease], [oldRelease], now).map(row => row.nextReleaseDate),
  ["2026-10-14"],
  "a recent missed release remains retryable after the active calendar advances",
);
assert.deepEqual(
  retryableHistoricalSchedules([nextRelease], [{ ...oldRelease, nextReleaseDate: "2026-10-12" }], now).map(row => row.nextReleaseDate),
  ["2026-10-12"],
  "date-only releases remain retryable for three full days after their scheduled date",
);
assert.deepEqual(
  retryableHistoricalSchedules([oldRelease], [oldRelease], now),
  [],
  "the currently active release schedule is not duplicated from history",
);
assert.deepEqual(
  retryableHistoricalSchedules([nextRelease], [{ ...oldRelease, nextReleaseDate: "2026-10-01" }], now),
  [],
  "historical schedules older than the retry window are ignored",
);
assert.equal(wasRecordedAfterSchedule("2026-10-15T07:47:03Z", "2026-10-14"), true);
assert.equal(wasRecordedAfterSchedule("2026-10-13T07:47:03Z", "2026-10-14"), false);
console.log("release schedule retry checks passed");
