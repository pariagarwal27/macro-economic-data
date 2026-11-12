import assert from "node:assert/strict";
import test from "node:test";
import { includeReleasePeriod, inflationReleaseRows, indexReleaseRows, pceReleaseRows, retailReleaseRows, retailBasketComponents } from "./release-driver-adapters";
import { CONTRIBUTION_CONFIGS } from "./inflation-contributions";

test("a newly released period is selectable before every component has arrived", () => {
  assert.deepEqual(includeReleasePeriod(["2026-08", "2026-07"], "2026-09"), ["2026-09", "2026-08", "2026-07"]);
  assert.deepEqual(includeReleasePeriod(["2026-08"], "invalid"), ["2026-08"]);
});

test("2024 CPI contributions use the BLS reference weight for that year", () => {
  const metrics = { "us-cpi-shelter": { meta: { unit: "index" }, history: [{date:"2024-11-01",value:100},{date:"2024-12-01",value:101}] } };
  const row = inflationReleaseRows(CONTRIBUTION_CONFIGS["us-cpi"], metrics, "2024-12", false, "mom").find(item => item.id === "us-cpi-shelter")!;
  assert.equal(row.weight, 36.191);
  assert.ok(Math.abs(row.current! - 0.36191) < 0.000001);
});

test("2025 CPI uses the historical 2025 BLS basket rather than 2026 weights", () => {
  const metrics = { "us-cpi-shelter": { meta: { unit: "index" }, history: [{date:"2025-04-01",value:100},{date:"2025-05-01",value:101}] } };
  const row = inflationReleaseRows(CONTRIBUTION_CONFIGS["us-cpi"], metrics, "2025-05", false, "mom").find(item => item.id === "us-cpi-shelter")!;
  assert.equal(row.weight, 35.483);
  assert.ok(Math.abs(row.current! - 0.35483) < 1e-10);
  assert.match(row.weightSource!, /2024\.htm/);
});

test("a 2025 core CPI contribution is normalized by the historical core basket", () => {
  const metrics = { "us-cpi-shelter": { meta: { unit: "index" }, history: [{date:"2025-04-01",value:100},{date:"2025-05-01",value:101}] } };
  const row = inflationReleaseRows(CONTRIBUTION_CONFIGS["us-cpi-core"], metrics, "2025-05", true, "mom").find(item => item.id === "us-cpi-shelter")!;
  assert.ok(Math.abs(row.current! - 35.483 / 80.093) < 1e-10);
});

test("CPI driver histories use six exact months and never include aggregate parents", () => {
  const metrics = {
    "us-cpi-new-vehicles": { meta: { unit: "index" }, history: [{date:"2026-07-01",value:100},{date:"2026-08-01",value:101},{date:"2026-09-01",value:103}] },
  };
  const rows = inflationReleaseRows(CONTRIBUTION_CONFIGS["us-cpi"], metrics, "2026-09", false, "mom");
  assert.ok(!rows.some(row => row.id === "us-core-goods-cpi-yoy"));
  const row = rows.find(row => row.id === "us-cpi-new-vehicles")!;
  assert.deepEqual(row.history.map(point => point.period), ["2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"]);
  assert.equal(row.history[0].value, null);
  assert.ok(Math.abs(row.current! - 3.838 * (103 / 101 - 1)) < 1e-10);
  assert.equal(row.history[5].value, row.current);
  assert.ok(Math.abs(row.rateHistory![5].value! - (103 / 101 - 1) * 100) < 1e-10);
  assert.notEqual(row.rateHistory![5].value, row.history[5].value);
  assert.equal(row.effectHistory![5].value, row.current);
});
test("historical CPI effects remain separate from rates when the selected month's effects are unavailable", () => {
  const metrics = { "us-cpi-new-vehicles": { meta: { unit: "index" }, history: [{date:"2026-07-01",value:100},{date:"2026-08-01",value:101}] } };
  const row = inflationReleaseRows(CONTRIBUTION_CONFIGS["us-cpi"], metrics, "2026-09", false, "mom").find(item => item.id === "us-cpi-new-vehicles")!;
  assert.equal(row.effectHistory![5].value, null);
  assert.ok(row.effectHistory![4].value != null);
  assert.ok(row.rateHistory![4].value != null);
  assert.notEqual(row.effectHistory![4].value, row.rateHistory![4].value);
});
test("PCE index rates are not fabricated weighted contributions", () => {
  const rows = indexReleaseRows([{id:"pce",label:"Goods",metricId:"goods"}], {goods:{meta:{unit:"index"},history:[{date:"2026-08-01",value:100},{date:"2026-09-01",value:102}]}}, "2026-09", "mom");
  assert.equal(rows[0].current, null);
  assert.ok(Math.abs(rows[0].rate! - 2) < 1e-10);
  assert.equal(rows[0].classification, "unclassified");
  assert.equal(rows[0].rateHistory![5].value, rows[0].rate);
});
test("PCE estimates monthly component effects from prior-month BEA expenditure shares", () => {
  const nodes = [{id:"health",label:"Health",metricId:"us-pce-healthcare"}];
  const metrics = {
    "us-pce-healthcare": {meta:{unit:"index"},history:[{date:"2025-08-01",value:100},{date:"2026-08-01",value:110},{date:"2026-09-01",value:111.1}]},
    "us-pce-spend-healthcare": {meta:{unit:"usd"},history:[{date:"2025-08-01",value:15},{date:"2026-08-01",value:20}]},
    "us-pce-spend-total": {meta:{unit:"usd"},history:[{date:"2025-08-01",value:100},{date:"2026-08-01",value:100}]},
    "us-pce-spend-core": {meta:{unit:"usd"},history:[{date:"2026-08-01",value:80}]},
  };
  const headline = pceReleaseRows(nodes, metrics, "2026-09", "mom", false)[0];
  assert.equal(headline.weight, 20);
  assert.ok(Math.abs(headline.current! - 0.2) < 1e-9);
  assert.equal(headline.effectHistory![5].value, headline.current);
  const core = pceReleaseRows(nodes, metrics, "2026-09", "mom", true)[0];
  assert.equal(core.weight, 25);
  assert.ok(Math.abs(core.current! - 0.25) < 1e-9);
  const missing = pceReleaseRows(nodes, metrics, "2026-10", "mom", false)[0];
  assert.equal(missing.current, null);
});
test("retail never substitutes a stale component month for the selection", () => {
  const rows = retailReleaseRows([{id:"food",label:"Food",metricId:"uk-retail-food-stores"}], {"uk-retail-food-stores":{meta:{unit:"percent"},history:[{date:"2026-08-01",value:1,rawValue:100}]}}, "2026-09", "mom");
  assert.equal(rows[0].rate, null);
  assert.equal(rows[0].history[5].value, null);
  assert.equal(rows[0].history[4].value, 1);
  assert.equal(rows[0].rateHistory![5].value, null);
  assert.equal(rows[0].rateHistory![4].value, 1);
});
test("UK headline includes fuel despite its legacy ID; only exact ex-fuel selection removes fuel", () => {
  const nodes = [{id:"food",label:"Food",metricId:"uk-retail-food-stores"},{id:"fuel",label:"Fuel",metricId:"uk-retail-automotive-fuel"},{id:"headline",label:"Headline",metricId:"uk-retail-sales-total-ex-fuel"}];
  assert.deepEqual(retailBasketComponents(nodes, "UK", "uk-retail-sales-total-ex-fuel").map(node => node.id), ["food", "fuel"]);
  assert.deepEqual(retailBasketComponents(nodes, "UK", "uk-retail-sales-ex-fuel").map(node => node.id), ["food"]);
});
