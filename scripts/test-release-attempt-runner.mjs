import assert from "node:assert/strict";
import { createReleaseAttemptRunner } from "../src/ingest/release-attempt-runner.ts";

const runner = createReleaseAttemptRunner();
let unblock;
const slowResponse = new Promise(resolve => { unblock = resolve; });
const started = [];
let fastAttempts = 0;
const slow = runner.run("slow", async () => {
  started.push("slow");
  await slowResponse;
  return { retryEligible: false };
}, () => true);
const fast = runner.run("fast", async () => {
  started.push("fast");
  return { retryEligible: ++fastAttempts < 3 };
}, () => true);
await fast;
assert.deepEqual(started, ["slow", "fast", "fast", "fast"], "fast retries must not wait for the slow metric");
assert.equal(fastAttempts, 3, "retry immediately until the attempt succeeds");
assert.equal(await runner.run("slow", async () => { throw Error("duplicate request"); }, () => true), null);
unblock();
await slow;
assert.equal(runner.isRunning("slow"), false);

let remaining = 2;
let attempts = 0;
await runner.run("window", async () => { attempts++; return { retryEligible: true }; }, () => remaining-- > 0);
assert.equal(attempts, 3, "stop retries when the hosted execution window expires");
const starts = [];
let releaseAll;
const barrier = new Promise(resolve => { releaseAll = resolve; });
const simultaneous = Array.from({ length: 10 }, (_, i) => runner.run(`metric-${i}`, async () => {
  starts.push(i);
  await barrier;
  return { retryEligible: false };
}, () => true));
assert.equal(starts.length, 10, "all ten metrics start before any response finishes");
releaseAll();
await Promise.all(simultaneous);
console.log("independent immediate release retry tests passed");
