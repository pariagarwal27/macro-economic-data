import assert from "node:assert/strict";
import {
  getActiveLiveMapping,
  getActiveLiveSource,
  getSourceConfig,
} from "../src/ingest/source-registry";

const expected: Record<string, string> = {
  "ea-core-hicp-yoy": "prc_hicp_minr_core",
  "ea-core-hicp-mom": "prc_hicp_mmor_core",
  "ea-hicp-mom": "prc_hicp_mmor",
  "ea-services-hicp-mom": "prc_hicp_mmor_serv",
  "ea-hicp-yoy": "prc_hicp_minr",
  "ea-services-hicp-yoy": "prc_hicp_minr_serv",
};

for (const [metricId, seriesId] of Object.entries(expected)) {
  const config = getSourceConfig(metricId);
  assert.equal(config?.adapter, "pipeline", `${metricId} must use the official pipeline adapter`);
  assert.equal(config?.source, "eurostat", `${metricId} must fetch from Eurostat`);
  assert.equal(config?.sourceId, seriesId, `${metricId} must use ${seriesId}`);
  assert.equal(getActiveLiveSource(metricId), "eurostat", `active source for ${metricId}`);
  assert.deepEqual(getActiveLiveMapping(metricId), { provider: "eurostat", seriesId });
}

console.log("Euro Area HICP release routes use Eurostat in the local worker");
