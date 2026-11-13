import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseAttemptRunner } from "./release-attempt-runner";
import { releaseRetryDelayMs } from "./release-clock";

const releaseAt = Date.parse("2026-11-12T13:30:00Z");
const scheduledAt = "2026-11-12T07:30:00-06:00";

test("a public source publishing one second late is detected within two seconds", async () => {
  for (const adapter of ["pipeline", "philadelphia", "ism", undefined]) {
    let now = releaseAt;
    const runner = createReleaseAttemptRunner();
    const result = await runner.run("release", async () => {
      const published = now >= releaseAt + 1_000;
      now += 100; // source response and persistence
      return { retryEligible: !published, value: published ? 200_000 : null };
    }, () => {
      now += releaseRetryDelayMs(adapter, scheduledAt, now);
      return now < releaseAt + 10_000;
    });
    assert.equal(result?.value, 200_000);
    assert.ok(now - releaseAt <= 2_000, `${adapter}: detected at T+${now - releaseAt}ms`);
  }
});

test("fast polling backs off after the immediate release window", () => {
  assert.equal(releaseRetryDelayMs("pipeline", scheduledAt, releaseAt + 60_000), 1_000);
  assert.equal(releaseRetryDelayMs("pipeline", scheduledAt, releaseAt + 300_000), 5_000);
  assert.equal(releaseRetryDelayMs("pipeline", scheduledAt, releaseAt - 1), 5_000);
  assert.equal(releaseRetryDelayMs("pipeline", "2026-11-12", releaseAt), 5_000);
  assert.equal(releaseRetryDelayMs("pipeline", "invalid", releaseAt), 5_000);
  assert.equal(releaseRetryDelayMs("lseg", scheduledAt, releaseAt + 100), 1_000);
  assert.equal(releaseRetryDelayMs("lseg", scheduledAt, releaseAt + 30_000), 5_000);
});
