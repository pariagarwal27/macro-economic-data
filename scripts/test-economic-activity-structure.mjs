import assert from "node:assert/strict";
import { DASHBOARD } from "../src/components/macro-ui-hierarchy.ts";
import { getMetric } from "../src/catalog/metrics.ts";
import { formatEconomicLevel } from "../src/lib/format.ts";

const byId = (region, id) =>
  DASHBOARD[region].activity.find((spec) => spec.id === id) ??
  DASHBOARD[region].external.find((spec) => spec.id === id);
const ids = (nodes = []) => nodes.flatMap((node) => [
  ...(node.metricId ? [node.metricId] : []),
  ...ids(node.children),
]);

const usActivity = DASHBOARD.US.activity.map((spec) => spec.id);
for (const id of [
  "us-gdp-card",
  "us-pce-growth-card",
  "us-investment-card",
  "us-government-card",
  "us-retail-sales-card",
  "us-pmi-card",
]) assert.ok(usActivity.includes(id), `US activity missing ${id}`);
assert.ok(!usActivity.includes("us-net-exports-card"));
assert.deepEqual(ids(byId("US", "us-gdp-card").components), ["us-gdp-real"]);
assert.deepEqual(ids(byId("US", "us-pce-growth-card").components), ["us-real-pce-growth", "us-real-pce-goods", "us-real-pce-durable-goods", "us-real-pce-nondurable-goods", "us-real-pce-services"]);
assert.deepEqual(ids(byId("US", "us-investment-card").components), ["us-real-private-investment", "us-real-fixed-investment", "us-real-nonresidential-investment", "us-real-structures", "us-real-equipment", "us-real-ipp", "us-real-residential-investment", "us-real-inventories"]);
assert.deepEqual(ids(byId("US", "us-government-card").components), ["us-real-government", "us-real-federal-government", "us-real-defense", "us-real-nondefense", "us-real-state-local"]);

const ukActivity = DASHBOARD.UK.activity.map((spec) => spec.id);
for (const id of ["uk-gdp-card", "uk-consumption-card", "uk-retail-sales-card", "uk-capital-card", "uk-pmi-card"])
  assert.ok(ukActivity.includes(id), `UK activity missing ${id}`);
assert.ok(!ukActivity.includes("uk-gdp-monthly-card"));
assert.ok(!ukActivity.includes("uk-household-card"));
assert.ok(!ukActivity.includes("uk-government-card"));
assert.ok(!ukActivity.includes("uk-net-trade-card"));
assert.deepEqual(ids(byId("UK", "uk-gdp-card").components), ["uk-gdp-qoq", "uk-gdp-mom"]);
assert.deepEqual(ids(byId("UK", "uk-consumption-card").components), ["uk-household-consumption-level", "uk-government-consumption-level"]);
assert.deepEqual(ids(byId("UK", "uk-capital-card").components), ["uk-gfcf-level", "uk-business-investment-qoq"]);
assert.ok(DASHBOARD.UK.external.some((spec) => spec.id === "uk-net-trade-card"));

const eaActivity = DASHBOARD.EA.activity.map((spec) => spec.id);
for (const id of ["ea-gdp-card", "ea-household-card", "ea-government-card", "ea-capital-card", "ea-retail-sales-card", "ea-pmi-card"])
  assert.ok(eaActivity.includes(id), `EA activity missing ${id}`);
assert.ok(!eaActivity.includes("ea-exports-card") && !eaActivity.includes("ea-imports-card"));
assert.deepEqual(ids(byId("EA", "ea-household-card")?.components), ["ea-household-consumption"]);
assert.deepEqual(ids(byId("EA", "ea-capital-card")?.components), ["ea-gfcf"]);
assert.deepEqual(ids(byId("EA", "ea-government-card")?.components), ["ea-government-consumption"]);
assert.ok(DASHBOARD.EA.external.some((spec) => spec.id === "ea-exports-card"));
assert.ok(DASHBOARD.EA.external.some((spec) => spec.id === "ea-imports-card"));

for (const id of ["us-gdp-real", "us-real-pce-growth", "us-real-private-investment", "us-real-government", "uk-gdp-qoq", "uk-household-consumption-level", "uk-government-consumption-level", "uk-gfcf-level", "ea-gdp-qoq", "ea-household-consumption", "ea-government-consumption", "ea-gfcf", "ea-exports", "ea-imports"])
  assert.equal(getMetric(id)?.frequency, "quarterly", `${id} must remain quarterly`);
for (const id of ["uk-gdp-mom", "us-retail-sales-total", "uk-retail-sales-total-ex-fuel", "ea-retail-sales-total-ex-motor-vehicles", "us-ism-manufacturing-pmi", "uk-sp-global-composite-pmi", "ea-sp-global-composite-pmi"])
  assert.equal(getMetric(id)?.frequency, "monthly", `${id} must remain monthly`);
for (const id of ["us-real-pce-growth", "us-real-private-investment", "us-real-government"])
  assert.equal(getMetric(id)?.unit, "usd_billions", `${id} should display BEA chained-dollar billions`);
for (const id of ["ea-household-consumption", "ea-government-consumption", "ea-gfcf", "ea-exports", "ea-imports"])
  assert.equal(getMetric(id)?.unit, "eur_millions", `${id} should display Eurostat chained-volume euro millions`);

assert.equal(getMetric("us-real-pce-growth")?.source, "bea");
assert.equal(getMetric("uk-household-consumption-level")?.source, "ons");
assert.equal(getMetric("ea-household-consumption")?.source, "eurostat");
assert.equal(formatEconomicLevel(12345.67, "usd_billions"), "$12,345.7B");
assert.equal(formatEconomicLevel(123456.7, "gbp_millions"), "£123.5B");
assert.equal(formatEconomicLevel(98765.4, "eur_millions"), "€98.8B");

console.log("Economic activity hierarchy and source-frequency checks passed.");
