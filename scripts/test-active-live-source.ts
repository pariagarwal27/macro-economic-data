import assert from "node:assert/strict";
import { getActiveLiveSource } from "../src/ingest/source-registry";
import { formatLiveSourceLabel } from "../src/lib/live-source-label";
import { METRICS } from "../src/catalog/metrics";

assert.equal(getActiveLiveSource("us-initial-claims"), "dol");
assert.equal(getActiveLiveSource("us-cpi"), "LSEG");
assert.equal(getActiveLiveSource("uk-unemployment"), "LSEG");
assert.equal(getActiveLiveSource("ea-unemployment"), "eurostat");
assert.equal(formatLiveSourceLabel(getActiveLiveSource("us-initial-claims")), "DOL");
assert.equal(formatLiveSourceLabel(null), "Not configured");

for (const metric of METRICS) {
  assert.ok(getActiveLiveSource(metric.id), `Missing active local source for ${metric.id}`);
}

console.log("Active live source routing labels passed.");
