import assert from "node:assert/strict";
import test from "node:test";
import { componentMomentumRows, completeMomentumTotal } from "./component-momentum";

test("effect totals are only displayed for months where every component is available", () => {
  assert.equal(completeMomentumTotal([0.1, -0.05, 0]), 0.05);
  assert.equal(completeMomentumTotal([0.1, null]), null);
  assert.equal(completeMomentumTotal([]), null);
});

test("momentum uses six calendar months ending with the selected month across a year boundary", () => {
  const result = componentMomentumRows([{ id: "shelter", label: "Shelter", rateHistory: [
    { period: "2025-12", value: 0.3 },
    { period: "2026-01", value: 0.2 },
    { period: "2026-02", value: 0.1 },
    { period: "2026-03", value: 0.4 },
  ] }], "2026-03");

  assert.deepEqual(result.months, ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(result.rows[0].values, [null, null, 0.3, 0.2, 0.1, 0.4]);
});

test("gaps remain unavailable and zero and negative monthly rates are retained", () => {
  const result = componentMomentumRows([{ id: "energy", label: "Energy", rateHistory: [
    { period: "2026-04", value: 0 },
    { period: "2026-06", value: -0.4 },
    { period: "2026-09", value: 0.2 },
  ] }], "2026-09");

  assert.deepEqual(result.rows[0].values, [0, null, -0.4, null, null, 0.2]);
});

test("the selected period excludes later observations and duplicate periods use the latest valid reading", () => {
  const result = componentMomentumRows([{ id: "food", label: "Food", rateHistory: [
    { period: "2026-09", value: 0.1 },
    { period: "2026-09", value: 0.2 },
    { period: "2026-09", value: null },
    { period: "2026-10", value: 9 },
  ] }], "2026-09");

  assert.equal(result.rows[0].values[5], 0.2);
  assert.equal(result.rows[0].values.length, 6);
  assert.ok(!result.rows[0].values.includes(9));
});

test("subtotal rows are not shown as separate components", () => {
  const result = componentMomentumRows([
    { id: "shelter", label: "Shelter", rateHistory: [{ period: "2026-09", value: 0.2 }] },
    { id: "subtotal", label: "Subtotal", subtotal: true, rateHistory: [{ period: "2026-09", value: 0.3 }] },
  ], "2026-09");

  assert.deepEqual(result.rows.map(row => row.id), ["shelter"]);
});
