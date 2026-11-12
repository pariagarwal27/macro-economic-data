import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseHistoryChart } from "./ReleaseHistoryChart";
import type { ReleaseDriverRow } from "@/lib/release-driver-model";

const rows: ReleaseDriverRow[] = [{ id: "shelter", label: "Shelter", weight: 35, rate: 0.4, current: 0.14, previous: 0.12, classification: "sticky", history: [], effectHistory: [{period:"2026-09",value:0.14}], rateHistory: [{period:"2026-09",value:0.4}] }];
test("weighted contribution history renders month stacks and a separate published headline", () => {
  const html = renderToStaticMarkup(<ReleaseHistoryChart title="CPI" period="2026-09" mode="mom" rows={rows} headlineHistory={[{period:"2026-09",value:0.3}]} rateLabel="Inflation" />);
  assert.match(html, /How inflation is evolving/);
  assert.match(html, /Estimated component effects/);
  assert.match(html, /September 2026/);
  assert.match(html, /Published CPI/);
  assert.match(html, /history-stack/);
});
test("unweighted PCE and retail show a headline line without adding component rates", () => {
  const ratesOnly = rows.map(row => ({...row, current:null, effectHistory:undefined, history:row.rateHistory!}));
  const html = renderToStaticMarkup(<ReleaseHistoryChart title="Retail sales" period="2026-09" mode="mom" rows={ratesOnly} headlineHistory={[{period:"2026-09",value:0.8}]} rateLabel="Sales change" />);
  assert.match(html, /Weighted contributions are unavailable/);
  assert.match(html, /component rates are not additive/);
  assert.doesNotMatch(html, /class="history-stack"/);
});
test("rate-only component history remains inspectable if no headline is available", () => {
  const ratesOnly = rows.map(row => ({...row, current:null, effectHistory:undefined, history:row.rateHistory!}));
  const html = renderToStaticMarkup(<ReleaseHistoryChart title="Core CPIH" period="2026-09" mode="mom" rows={ratesOnly} headlineHistory={[]} rateLabel="Inflation" />);
  assert.match(html, /September 2026: show component details/);
  assert.doesNotMatch(html, /No matching observations/);
  assert.match(html, /role="group"/);
});
