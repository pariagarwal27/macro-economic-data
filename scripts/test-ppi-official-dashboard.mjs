import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { METRICS } from "../src/catalog/metrics.ts";
import { LIVE_MAP } from "../src/catalog/live-map.ts";
import { DASHBOARD } from "../src/components/macro-ui-hierarchy.ts";
import { PPI_RELEASE_PEERS } from "../src/ingest/release-schedule-retries.ts";

const regionPrefixes = { US: "us", UK: "uk", EA: "ea" };
for (const [region, prefix] of Object.entries(regionPrefixes)) {
  const card = DASHBOARD[region].prices.find(spec => spec.id === `${prefix}-ppi-card`);
  assert.ok(card, `${region} prices should include a dedicated PPI card`);
  assert.ok(card.components.length > 1, `${region} PPI should expose official component series`);
  for (const component of card.components) {
    assert.ok(component.metricId, `${region} PPI component ${component.label} must map to YoY`);
    assert.ok(component.momMetricId, `${region} PPI component ${component.label} must map to MoM`);
  }
}

const ukPpiGroups = [
  ["uk-ppi-food-beverages-tobacco-yoy", "GBA7"],
  ["uk-ppi-alcohol-tobacco-yoy", "GB7V"],
  ["uk-ppi-textiles-yoy", "GB7W"],
  ["uk-ppi-paper-yoy", "GB7X"],
  ["uk-ppi-petroleum-yoy", "GB7Y"],
  ["uk-ppi-chemicals-yoy", "GB7Z"],
  ["uk-ppi-metals-machinery-yoy", "GB82"],
  ["uk-ppi-computers-electronics-yoy", "GB83"],
  ["uk-ppi-vehicles-yoy", "GB84"],
  ["uk-ppi-input-fuel-yoy", "FSQ3"],
  ["uk-ppi-input-chemicals-yoy", "FSQ7"],
  ["uk-ppi-input-metals-yoy", "FSQ8"],
  ["uk-ppi-import-yoy", "GD74"],
];
for (const [id, seriesId] of ukPpiGroups) {
  const yoy = METRICS.find(metric => metric.id === id);
  const momId = id.replace(/-yoy$/, "-mom");
  const mom = METRICS.find(metric => metric.id === momId);
  assert.equal(yoy?.seriesId, seriesId, `${id} must use its verified ONS series`);
  assert.equal(mom?.seriesId, seriesId, `${momId} must use the same official ONS index`);
  assert.equal(LIVE_MAP[id]?.provider, "ons", `${id} must route to ONS`);
  assert.equal(LIVE_MAP[momId]?.provider, "ons", `${momId} must route to ONS`);
  const ukCard = DASHBOARD.UK.prices.find(spec => spec.id === "uk-ppi-card");
  assert.ok(ukCard.components.some(component => component.metricId === id && component.momMetricId === momId), `${id} must appear as a paired UK dashboard component`);
  assert.equal(PPI_RELEASE_PEERS[id], momId, `${momId} must inherit the official UK PPI release schedule`);
}
const usPpiGroups = [
  ["us-ppi-intermediate-stage-1-yoy", "WPUID51", "us-ppi-intermediate-stage-1-mom", "WPSID51"],
  ["us-ppi-intermediate-stage-2-yoy", "WPUID52", "us-ppi-intermediate-stage-2-mom", "WPSID52"],
  ["us-ppi-intermediate-stage-3-yoy", "WPUID53", "us-ppi-intermediate-stage-3-mom", "WPSID53"],
  ["us-ppi-intermediate-stage-4-yoy", "WPUID54", "us-ppi-intermediate-stage-4-mom", "WPSID54"],
  ["us-ppi-final-demand-trade-yoy", "WPUFD423", "us-ppi-final-demand-trade-mom", "WPSFD423"],
  ["us-ppi-final-demand-transport-yoy", "WPUFD422", "us-ppi-final-demand-transport-mom", "WPSFD422"],
  ["us-ppi-intermediate-processed-goods-yoy", "WPUID61", "us-ppi-intermediate-processed-goods-mom", "WPSID61"],
  ["us-ppi-intermediate-unprocessed-goods-yoy", "WPUID62", "us-ppi-intermediate-unprocessed-goods-mom", "WPSID62"],
  ["us-ppi-intermediate-services-yoy", "WPUID63", "us-ppi-intermediate-services-mom", "WPSID63"],
  ["us-ppi-intermediate-construction-yoy", "WPUID64", "us-ppi-intermediate-construction-mom", "WPSID64"],
];
for (const [id, yoySeriesId, momId, momSeriesId] of usPpiGroups) {
  assert.equal(METRICS.find(metric => metric.id === id)?.seriesId, yoySeriesId);
  assert.equal(METRICS.find(metric => metric.id === momId)?.seriesId, momSeriesId);
  assert.equal(LIVE_MAP[id]?.provider, "bls");
  assert.equal(LIVE_MAP[momId]?.provider, "bls");
  assert.equal(PPI_RELEASE_PEERS[id], momId);
  const usCard = DASHBOARD.US.prices.find(spec => spec.id === "us-ppi-card");
  assert.ok(usCard.components.some(component => component.metricId === id && component.momMetricId === momId));
}

const onsAdapter = await readFile(new URL("../src/ingest/ons.ts", import.meta.url), "utf8");
for (const [, seriesId] of ukPpiGroups) {
  assert.ok(onsAdapter.includes(`${seriesId}: "/economy/inflationandpriceindices/timeseries/${seriesId.toLowerCase()}/ppi"`), `${seriesId} must fetch from its official ONS time-series URI`);
}

const ppiMetrics = METRICS.filter(metric => /^(us|uk|ea)-ppi-/.test(metric.id) || ["us-ppi-final-demand", "us-ppi-core", "uk-ppi-output-yoy", "uk-ppi-input-yoy", "ea-ppi-yoy", "ea-ppi-mom"].includes(metric.id));
assert.ok(ppiMetrics.length >= 25, "PPI catalog should contain headline and component rates for all regions");
for (const metric of ppiMetrics) {
  const route = LIVE_MAP[metric.id];
  assert.ok(["bls", "ons", "eurostat"].includes(route?.provider ?? metric.source), `${metric.id} must route to an official agency`);
  assert.ok(metric.officialUrl.startsWith("https://"), `${metric.id} should cite its official source over HTTPS`);
}

const registry = await readFile(new URL("../src/ingest/source-registry.ts", import.meta.url), "utf8");
for (const id of ["us-ppi-final-demand", "us-ppi-core", "uk-ppi-output-yoy", "uk-ppi-input-yoy", "ea-ppi-yoy"]) {
  assert.ok(!new RegExp(`\\[\\s*"${id}"\\s*,`).test(registry), `${id} must not have an LSEG live route`);
}
for (const headlineId of ["us-ppi-final-demand", "uk-ppi-output-yoy", "ea-ppi-yoy"]) {
  assert.ok(ppiMetrics.some(metric => metric.id === headlineId), `missing official PPI headline ${headlineId}`);
}

console.log(`Official PPI dashboard contract passed (${ppiMetrics.length} catalog metrics).`);
