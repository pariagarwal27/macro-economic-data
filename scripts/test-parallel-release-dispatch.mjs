import assert from "node:assert/strict";
import { mapConcurrent } from "../src/ingest/release-concurrency.ts";

const started = [];
let releaseBatch;
const batchGate = new Promise((resolve) => {
  releaseBatch = resolve;
});

const work = mapConcurrent(["continuing-claims", "initial-claims"], async (metricId) => {
  started.push(metricId);
  await batchGate;
  return metricId;
});

await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  started.sort(),
  ["continuing-claims", "initial-claims"],
  "all claims fetches in the batch should start before either response completes"
);

releaseBatch();
assert.deepEqual(await work, ["continuing-claims", "initial-claims"]);

const largeBatchStarted = [];
let releaseLargeBatch;
const largeBatchGate = new Promise((resolve) => {
  releaseLargeBatch = resolve;
});
const allEligible = Array.from({ length: 45 }, (_, index) => index);
const largeWork = mapConcurrent(allEligible, async (metricId) => {
  largeBatchStarted.push(metricId);
  await largeBatchGate;
  return metricId;
});

await new Promise((resolve) => setImmediate(resolve));
assert.equal(largeBatchStarted.length, allEligible.length, "every eligible metric should start before any request completes");
releaseLargeBatch();
assert.deepEqual(await largeWork, allEligible);
console.log("All eligible release metrics start concurrently without sequential batches");
