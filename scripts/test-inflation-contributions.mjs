import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(path, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: id => imports[id] });
  return exports;
}
const weights = load("../src/lib/official-component-weights.ts");
const { CONTRIBUTION_CONFIGS: configs, buildInflationContributions: build, contributionRate: rate, previousContributionMonth: previousMonth } = load("../src/lib/inflation-contributions.ts", { "./official-component-weights": weights });
const metric = (points, unit = "percent") => ({ meta: { unit, transform: "published_rate" }, history: points.map(([date, value]) => ({ date, value })) });

test("US headline uses disjoint categories and compares the same measure in adjacent months", () => {
  const config = configs["us-cpi"];
  assert.equal(config.components.length, 4);
  assert.ok(!config.components.some(row => row.id === "us-cpi-core"));
  const metrics = Object.fromEntries(config.components.map(row => [row.id, metric([["2026-07-01", 2], ["2026-08-01", 3]])]));
  const result = build(config, metrics, "2026-08", false, "yoy");
  const food = result.rows.find(row => row.id === "us-cpi-food");
  assert.ok(Math.abs(food.current - 0.41094) < 1e-9);
  assert.ok(Math.abs(food.previous - 0.27396) < 1e-9);
  assert.ok(Math.abs(food.change - 0.13698) < 1e-9);
});
test("core weights are normalized, excluding food and energy", () => {
  const config = configs["ea-core-hicp-yoy"];
  const metrics = Object.fromEntries(config.coreComponents.map(row => [row.id, metric([["2026-08-01", 3]])]));
  const result = build(config, metrics, "2026-08", true, "yoy");
  assert.equal(result.rows.length, 2);
  assert.ok(Math.abs(result.coverage - 100) < 1e-9);
  assert.ok(Math.abs(result.estimated - 3) < 1e-9);
});
test("annual rates cannot be interpreted as MoM; published monthly rates work", () => {
  const annual = metric([["2026-08-01", 5]]);
  assert.equal(rate(annual, "2026-08", "mom", "yoy"), null);
  assert.equal(rate(annual, "2026-08", "mom", "mom"), 5);
  const result = build(configs["uk-cpih-yoy"], { "uk-food-cpih-yoy": annual, "uk-food-cpih-mom": metric([["2026-08-01", 0.2]]) }, "2026-08", false, "mom");
  assert.ok(Math.abs(result.rows.find(row => row.id === "uk-food-cpih-yoy").current - 0.017316) < 1e-9);
});
test("index growth requires exact calendar baselines and excludes unmatched source periods", () => {
  const index = metric([["2025-08-01", 100], ["2026-06-01", 105], ["2026-08-01", 110]], "index");
  assert.ok(Math.abs(rate(index, "2026-08", "yoy") - 10) < 1e-9);
  assert.equal(rate(index, "2026-08", "mom"), null);
  assert.equal(previousMonth("2026-01"), "2025-12");
});
test("weights never silently cross years; missing contributions are not zero", () => {
  const config = configs["uk-cpi-yoy"];
  const result = build(config, { "uk-food-cpi-yoy": metric([["2025-12-01", 2], ["2026-01-01", 3]]) }, "2026-01", false, "yoy");
  const food = result.rows.find(row => row.id === "uk-food-cpi-yoy");
  assert.equal(food.previous, null);
  assert.equal(food.change, null);
  assert.equal(result.rows.find(row => row.id === "uk-transport-cpi-yoy").current, null);
  assert.equal(result.residual, null);
});
