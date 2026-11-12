import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseDriverReport } from "./ReleaseDriverReport";
import type { ReleaseDriverRow } from "../lib/release-driver-model";

const row: ReleaseDriverRow = {
  id: "rent", label: "Rent", weight: 35, rate: 0.5, current: 0.18, previous: 0.15,
  classification: "sticky", history: [0.08, 0.10, 0.11, 0.13, 0.15, 0.18].map((value, index) => ({period:`2026-${String(index + 4).padStart(2,"0")}`,value})),
};
const render = (effects = true, rows = [row]) => renderToStaticMarkup(<ReleaseDriverReport title="CPI" period="2026-09" mode="mom" rows={rows} effects={effects} published={0.32} note="Source note" />);
test("table summaries leave inflation and history cells empty", () => {
  const html = render();
  const total = html.match(/<tr class="release-grand-total">([\s\S]*?)<\/tr>/)![1];
  assert.ok(total.includes('aria-label="Component rates are not summed"></td>'));
  assert.ok(total.includes('aria-label="History is not summed"></td>'));
  assert.ok(!total.includes("0.50%"));
  assert.ok(total.includes("35.00%"));
});
test("six monthly bars expose dated values and their horizontal median", () => {
  const html = render();
  assert.ok(html.includes("Median +0.12 pp"));
  assert.ok(html.includes('class="release-median"'));
  assert.equal((html.match(/selected release/g) ?? []).length, 1);
  assert.ok(!html.includes("NaN"));
  assert.ok(!html.includes("Infinity"));
});
test("unweighted component rates never receive an additive waterfall total", () => {
  const html = render(false, [{...row, classification:"unclassified",current:null,history:row.history}]);
  assert.ok(html.includes("Component rates — not an additive decomposition"));
  assert.ok(!html.includes("release-grand-total"));
  assert.ok(!html.includes("Shown net"));
  assert.ok(!html.includes("Group subtotal"));
});
