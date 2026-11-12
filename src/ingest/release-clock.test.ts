import assert from "node:assert/strict";
import test from "node:test";
import { waitForReleaseInstant, exactReleaseTimestamp } from "./release-clock";

test("request timer rechecks an early timer instead of sending before publication", async () => {
  let time = 0;
  const waits: number[] = [];
  await waitForReleaseInstant("2026-10-28T06:00:00Z", {
    now: () => Date.parse("2026-10-28T05:59:55Z") + time,
    sleep: async ms => { waits.push(ms); time += waits.length === 1 ? ms - 10 : ms; },
  });
  assert.equal(time, 5000);
  assert.ok(waits.every(ms => ms <= 1000));
});

test("late requests start immediately and date-only releases do not invent a time", async () => {
  let waits = 0;
  const clock = {now: () => Date.parse("2026-10-28T06:00:02Z"), sleep: async () => { waits++; }};
  await waitForReleaseInstant("2026-10-28T06:00:00Z", clock);
  await waitForReleaseInstant("2026-10-28", clock);
  assert.equal(waits, 0);
  assert.equal(exactReleaseTimestamp("2026-10-28"), null);
  assert.equal(exactReleaseTimestamp("2026-10-28T07:00:00+01:00"), Date.parse("2026-10-28T06:00:00Z"));
});
