import assert from "node:assert/strict";
import { METRICS } from "../src/catalog/metrics";
import { fetchBlsSeries } from "../src/ingest/bls";
import {
  getActiveLiveSource,
  getActiveLiveMapping,
  getCloudSourceConfig,
  getSourceConfig,
  isUsCpiMetric,
  shouldMergeHistoricalBackfill,
} from "../src/ingest/source-registry";

const expectedLsegRoutes: Record<string, string> = {
  "us-cpi": "USCPN=ECI",
  "us-cpi-yoy": "USCPNY=ECI",
  "us-cpi-mom": "USCPI=ECI",
  "us-cpi-core": "USCPNX=ECI",
  "us-core-cpi-mom": "USCPF=ECI",
  "us-core-cpi-yoy": "USCPFY=ECI",
};
const expectedBlsRoutes: Record<string, string> = {
  "us-cpi-core-nsa": "CUUR0000SA0L1E",
  "us-cpi-new-vehicles": "CUSR0000SETA01",
  "us-cpi-used-cars": "CUSR0000SETA02",
  "us-cpi-medical-commodities": "CUSR0000SAM1",
  "us-cpi-recreation-commodities": "CUSR0000SARC",
  "us-cpi-education-commodities": "CUSR0000SAEC",
  "us-cpi-recreation-services": "CUSR0000SARS",
  "us-cpi-education-services": "CUSR0000SAES",
  "us-cpi-other-services": "CUSR0000SAS367",
};

for (const [metricId, ric] of Object.entries(expectedLsegRoutes)) {
  assert.equal(shouldMergeHistoricalBackfill(metricId), true, `${metricId} backfill must preserve existing observations`);
  for (const [runtime, config] of [
    ["local", getSourceConfig(metricId)],
    ["hosted", getCloudSourceConfig(metricId)],
  ] as const) {
    assert.equal(config?.adapter, "lseg", `${runtime} ${metricId} must use LSEG`);
    assert.equal(config?.sourceId, ric, `${runtime} ${metricId} must use ${ric}`);
  }
  assert.equal(getActiveLiveSource(metricId, false), "LSEG");
  assert.equal(getActiveLiveSource(metricId, true), "LSEG");
}

const cpiMetrics = METRICS.filter((metric) => isUsCpiMetric(metric.id));
assert.ok(cpiMetrics.length > 0, "The US CPI family should be detected");
for (const metric of cpiMetrics) {
  const isBlsException = Object.hasOwn(expectedBlsRoutes, metric.id);
  assert.equal(shouldMergeHistoricalBackfill(metric.id), !isBlsException, `${metric.id} must merge only when routed through LSEG`);
  for (const [runtime, config] of [
    ["local", getSourceConfig(metric.id)],
    ["hosted", getCloudSourceConfig(metric.id)],
  ] as const) {
    assert.ok(
      isBlsException ? config?.source === "bls" : config === null || config.adapter === "lseg",
      `${runtime} ${metric.id} must use ${isBlsException ? "BLS" : "LSEG or unavailable"}, got ${config?.source ?? "unavailable"}`
    );
    assert.equal(getActiveLiveSource(metric.id, runtime === "hosted"), isBlsException ? "bls" : (config ? "LSEG" : null));
    const mapping = getActiveLiveMapping(metric.id, runtime === "hosted");
    assert.equal(mapping?.provider, isBlsException ? "bls" : (config ? "lseg" : undefined));
    if (isBlsException) assert.equal(config?.sourceId, expectedBlsRoutes[metric.id]);
  }
}

console.log(`US CPI routing verified: ${Object.keys(expectedLsegRoutes).length} primary LSEG routes; ${Object.keys(expectedBlsRoutes).length} BLS component routes`);
console.log(
  "CPI metrics still unavailable (no LSEG route and no approved BLS exception):",
  cpiMetrics.filter((metric) => getSourceConfig(metric.id) === null).map((metric) => metric.id).join(", ")
);

let blsRequests = 0;
let blsRequestIds: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input, init) => {
  blsRequests += 1;
  blsRequestIds = JSON.parse(String(init?.body)).seriesid;
  return new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;
try {
  await fetchBlsSeries(["CUSR0000SA0", "CUUR0000SA0", "CUUR0000SA0L1E", expectedBlsRoutes["us-cpi-new-vehicles"]]);
  assert.equal(blsRequests, 1, "BLS batch should request explicitly routed CPI components");
  assert.deepEqual(blsRequestIds, [expectedBlsRoutes["us-cpi-new-vehicles"]], "BLS batch must exclude LSEG-routed headline/core CPI series");
} finally {
  globalThis.fetch = originalFetch;
}
