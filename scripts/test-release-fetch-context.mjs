import assert from "node:assert/strict";
import { isFreshReleaseFetch, withFreshReleaseFetch } from "../src/ingest/release-fetch-context.js";

assert.equal(isFreshReleaseFetch(), false);
await Promise.all([
  withFreshReleaseFetch(async () => {
    await Promise.resolve();
    assert.equal(isFreshReleaseFetch(), true, "release retries must bypass provider snapshots across awaits");
  }),
  (async () => {
    await Promise.resolve();
    assert.equal(isFreshReleaseFetch(), false, "release retries must not change unrelated background cache behavior");
  })(),
]);
assert.equal(isFreshReleaseFetch(), false);
console.log("fresh release fetch context isolation tests passed");
