import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseDriverReport } from "./ReleaseDriverReport";
import type { ReleaseDriverRow } from "@/lib/release-driver-model";

const rows: ReleaseDriverRow[] = [
  { id: "shelter", label: "Shelter", weight: 40, rate: 0.5, current: 0.2, previous: 0.1, classification: "sticky", history: [], rateHistory: [], effectHistory: [{ period: "2026-09", value: 0.2 }], threeMonthSaar: 3, threeMonthEffect: 1.2 },
  { id: "food", label: "Food", weight: 20, rate: -0.1, current: -0.02, previous: 0, classification: "flexible", history: [], rateHistory: [], effectHistory: [{ period: "2026-09", value: -0.02 }], threeMonthSaar: -1, threeMonthEffect: -0.2 },
];
const render = (props: { classified?: boolean; classificationBasis?: "pce-proxy" }, data = rows) => renderToStaticMarkup(
  <ReleaseDriverReport title="Inflation" period="2026-09" mode="mom" rows={data} effects note="" {...props} />,
);
const table = (html: string, kind: string) => html.match(new RegExp(`<table class="momentum-table momentum-${kind}">[\\s\\S]*?<\\/table>`))?.[0] ?? "";

for (const [basket, props] of [["US CPI", { classified: true }], ["PCE", { classificationBasis: "pce-proxy" as const }]] as const) {
  test(`${basket} renders the final SAAR column in both tables with percentage-point subtotals and totals`, () => {
    const html = render(props);
    const rates = table(html, "rates"), effects = table(html, "effects");
    assert.match(rates, /3m\/3m SAAR<\/th>/);
    assert.match(rates, />\+3\.00%<\/td>/);
    assert.match(effects, /3m\/3m SAAR \(pp\)<\/th>/);
    assert.match(effects, />\+1\.20 pp<\/td>/);
    assert.match(effects, />-0\.20 pp<\/td>/);
    assert.match(effects, /TOTAL — DISPLAYED COMPONENTS<\/th>[\s\S]*?>\+1\.00 pp<\/td><\/tr>/);
    assert.match(rates, /colspan="9"/i);
    assert.match(effects, /colspan="8"/i);
  });
}

test("a missing annualized effect keeps its final cell and total unavailable", () => {
  const effects = table(render({ classified: true }, rows.map(row => row.id === "food" ? { ...row, threeMonthEffect: null } : row)), "effects");
  assert.match(effects, /TOTAL — DISPLAYED COMPONENTS<\/th>[\s\S]*?>—<\/td><\/tr>/);
});

test("other regions and retail do not gain the US inflation SAAR column", () => {
  assert.doesNotMatch(render({}), /3m\/3m SAAR/);
});
