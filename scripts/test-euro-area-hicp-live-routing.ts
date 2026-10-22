import assert from "node:assert/strict";
import {
  getActiveLiveMapping,
  getActiveLiveSource,
  getCloudSourceConfig,
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
  for (const [runtime, hosted] of [["local", false], ["hosted", true]] as const) {
    const config = hosted ? getCloudSourceConfig(metricId) : getSourceConfig(metricId);
    assert.equal(config?.adapter, "pipeline", `${runtime} ${metricId} must use the official pipeline adapter`);
    assert.equal(config?.source, "eurostat", `${runtime} ${metricId} must fetch from Eurostat`);
    assert.equal(config?.sourceId, seriesId, `${runtime} ${metricId} must use ${seriesId}`);
    assert.equal(getActiveLiveSource(metricId, hosted), "eurostat", `${runtime} active source for ${metricId}`);
    assert.deepEqual(getActiveLiveMapping(metricId, hosted), {
      provider: "eurostat",
      seriesId,
    });
  }
}

console.log("Euro Area HICP release routes use Eurostat in local and hosted workers");
