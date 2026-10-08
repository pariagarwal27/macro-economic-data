import assert from "node:assert/strict";
import { getActiveLiveSource } from "../src/ingest/source-registry";
import { formatLiveSourceLabel } from "../src/lib/live-source-label";
import { METRICS } from "../src/catalog/metrics";

assert.equal(getActiveLiveSource("us-initial-claims", true), "dol");
assert.equal(getActiveLiveSource("us-initial-claims", false), "dol");
assert.equal(getActiveLiveSource("us-cpi", true), "bls");
assert.equal(getActiveLiveSource("us-cpi", false), "LSEG");
assert.equal(getActiveLiveSource("uk-unemployment", true), "ons");
assert.equal(getActiveLiveSource("uk-unemployment", false), "LSEG");
assert.equal(getActiveLiveSource("ea-unemployment", true), "eurostat");
assert.equal(getActiveLiveSource("ea-unemployment", false), "LSEG");
assert.equal(getActiveLiveSource("ea-inflation-comp-5y5y", true), null);
assert.equal(formatLiveSourceLabel(getActiveLiveSource("us-initial-claims", true)), "DOL");
assert.equal(formatLiveSourceLabel(null), "Not configured");

for (const metric of METRICS) {
  assert.ok(getActiveLiveSource(metric.id, false), `Missing active local source for ${metric.id}`);
}

console.log("Active live source routing labels passed.");
