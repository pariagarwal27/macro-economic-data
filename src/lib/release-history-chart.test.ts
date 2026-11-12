import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseHistoryChart, sortTooltipComponents } from "./release-history-chart";

test("tooltip components are ordered by descending signed value with missing values last", () => {
  const items = [{label:"Missing",value:null}, {label:"Negative",value:-0.2}, {label:"Small",value:0.04}, {label:"Large",value:0.33}, {label:"Zero",value:0}];
  assert.deepEqual(sortTooltipComponents(items).map(item => item.label), ["Large", "Small", "Zero", "Negative", "Missing"]);
  assert.equal(items[0].label, "Missing");
});

test("six exact calendar months end at the selected month and cross year boundaries", () => {
  const result = buildReleaseHistoryChart([], "2026-03");
  assert.deepEqual(result.map(month => month.period), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.equal(result[5].shownNet, null);
  assert.equal(result[5].headline, null);
});

test("positive and negative effects stack separately, including zero and partial data", () => {
  const rows = [
    { id: "shelter", label: "Shelter", classification: "sticky", history: [{ period: "2026-09", value: 0.2 }] },
    { id: "food", label: "Food", classification: "flexible", history: [{ period: "2026-09", value: 0.1 }] },
    { id: "cars", label: "Cars", classification: "flexible", history: [{ period: "2026-09", value: -0.05 }] },
    { id: "goods", label: "Goods", classification: "flexible", history: [{ period: "2026-09", value: 0 }] },
    { id: "missing", label: "Missing", classification: "unclassified", history: [] },
  ];
  const current = buildReleaseHistoryChart(rows, "2026-09", [{ period: "2026-09", value: 0.3 }])[5];
  assert.deepEqual(current.segments.map(({value,start,end}) => [value,start,end]), [
    [0.2,0,0.2], [0.1,0.2,0.30000000000000004], [-0.05,0,-0.05], [0,0.30000000000000004,0.30000000000000004], [null,null,null],
  ]);
  assert.ok(Math.abs(current.shownNet! - 0.25) < 1e-10);
  assert.equal(current.positiveTotal, 0.30000000000000004);
  assert.equal(current.negativeTotal, -0.05);
  assert.equal(current.partial, true);
  assert.equal(current.availableCount, 4);
  assert.equal(current.missingCount, 1);
  assert.equal(current.headline, 0.3);
});

test("no data stays missing, future dates are excluded, and the last valid duplicate wins", () => {
  const months = buildReleaseHistoryChart([{ id: "food", label: "Food", history: [
    { period: "2026-09", value: 0.1 }, { period: "2026-09", value: 0.2 },
    { period: "2026-09", value: null }, { period: "2026-10", value: 9 },
  ] }], "2026-09", [{period:"2026-09", value:0}, {period:"2026-10", value:7}]);
  assert.equal(months[0].shownNet, null);
  assert.equal(months[0].segments[0].value, null);
  assert.equal(months[0].partial, true);
  assert.equal(months[5].segments[0].value, 0.2);
  assert.equal(months[5].shownNet, 0.2);
  assert.equal(months[5].headline, 0);
  assert.equal(months[5].partial, false);
});

test("subtotal and duplicate rows cannot be counted twice", () => {
  const months = buildReleaseHistoryChart([
    { id: "food", label: "Food", history: [{period:"2026-09",value:0.2}] },
    { id: "food", label: "Duplicate", history: [{period:"2026-09",value:0.2}] },
    { id: "total", label: "Subtotal", subtotal: true, history: [{period:"2026-09",value:0.5}] },
  ], "2026-09");
  assert.deepEqual(months[5].segments.map(segment => segment.id), ["food"]);
  assert.equal(months[5].shownNet, 0.2);
});
