import assert from "node:assert/strict";
import { METRICS } from "../src/catalog/metrics";
import { LIVE_MAP } from "../src/catalog/live-map";
import { getCloudSourceConfig, getSourceConfig } from "../src/ingest/source-registry";
import { EA_HICP_COMPONENT_RELEASE_PEERS, inheritReleaseSchedules } from "../src/ingest/release-schedule-retries";
import { DASHBOARD, flattenMetricIds } from "../src/components/macro-ui-hierarchy";
import { getPublishedComponentMeasureIds } from "../src/lib/component-detail-measures";

const expected = [
  ["ea-food-hicp-yoy", "ea-food-hicp-mom", "prc_hicp_mmor_food"],
  ["ea-energy-hicp-yoy", "ea-energy-hicp-mom", "prc_hicp_mmor_nrg"],
  ["ea-goods-hicp-yoy", "ea-goods-hicp-mom", "prc_hicp_mmor_igd_nnrg"],
] as const;

const headline = DASHBOARD.EA.prices.find(spec => spec.id === "ea-hicp-card");
assert.ok(headline, "Euro Area headline HICP card must exist");
const visibleComponents = headline.components ?? [];

for (const [yoyId, momId, seriesId] of expected) {
  assert.ok(METRICS.some(metric => metric.id === momId), `${momId} must be a catalog metric`);
  assert.equal(LIVE_MAP[momId]?.provider, "eurostat", `${momId} must use Eurostat`);
  assert.equal(LIVE_MAP[momId]?.seriesId, seriesId, `${momId} must map to ${seriesId}`);
  for (const config of [getSourceConfig(momId), getCloudSourceConfig(momId)]) {
    assert.equal(config?.adapter, "pipeline", `${momId} must use the official pipeline adapter`);
    assert.equal(config?.source, "eurostat", `${momId} must use the Eurostat source`);
  }
  const node = visibleComponents.find(component => component.metricId === yoyId);
  assert.equal(node?.momMetricId, momId, `${yoyId} display row must pair its published MoM metric`);
  assert.ok(flattenMetricIds([node!]).includes(momId), `${momId} must be included in component fetch IDs`);
  assert.deepEqual(getPublishedComponentMeasureIds(yoyId), { yoyMetricId: yoyId, momMetricId: momId }, `${yoyId} detail drawer must load both published measures`);
}
assert.equal(getPublishedComponentMeasureIds("ea-hicp-yoy"), null, "headline HICP continues using its existing detail spec");

const sourceSchedule = {
  metricId: "ea-food-hicp-yoy",
  metricName: "Euro Area Food HICP YoY",
  nextReleaseDate: "2026-10-16",
  nextReleaseAt: "2026-10-16T11:00:00+02:00",
  status: "official_date",
  source: "Eurostat",
  family: "HICP",
  officialSource: "https://ec.europa.eu/eurostat",
  officialEvidence: null,
  updatedAt: "2026-10-15T12:00:00Z",
};
const pairedSchedules = expected.map(([yoyId]) => ({ ...sourceSchedule, metricId: yoyId }));
const inherited = inheritReleaseSchedules(pairedSchedules, EA_HICP_COMPONENT_RELEASE_PEERS);
assert.deepEqual(inherited.map(row => row.metricId).sort(), expected.map(([, momId]) => momId).sort());
assert.ok(inherited.every(row => row.nextReleaseAt === sourceSchedule.nextReleaseAt), "MoM must refresh on each official paired release time");

console.log("Euro Area HICP component MoM metrics are routed, fetched, and paired in the component field");
