import assert from "node:assert/strict";
import { mapConcurrent } from "../src/ingest/release-concurrency.ts";

const started = [];
let releaseBatch;
const batchGate = new Promise((resolve) => {
  releaseBatch = resolve;
});

const work = mapConcurrent(["continuing-claims", "initial-claims"], 2, async (metricId) => {
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
console.log("Parallel release dispatch starts eligible metric fetches together");
