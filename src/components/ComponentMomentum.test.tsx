import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseDriverReport } from "./ReleaseDriverReport";
import type { ReleaseDriverRow } from "@/lib/release-driver-model";

const row: ReleaseDriverRow = {
  id: "energy", label: "Energy", weight: 5, rate: 0.3, current: 0.01, previous: 0.02,
  classification: "flexible", history: [{ period: "2026-09", value: 0.01 }],
  effectHistory: [{ period: "2026-04", value: -0.01 }, { period: "2026-09", value: 0.01 }],
  rateHistory: [{ period: "2026-04", value: -0.2 }, { period: "2026-09", value: 0.3 }],
};

test("grouped rate and effect heatmaps replace the old contribution table", () => {
  const html = renderToStaticMarkup(<ReleaseDriverReport title="CPI" period="2026-09" mode="mom" rows={[row]} effects note="Test" />);
  assert.ok(html.indexOf("release-chart-panel") < html.indexOf("Component momentum"));
  assert.ok(html.indexOf("Component momentum") < html.indexOf("Component effects · last 6 months"));
  assert.match(html, /MoM inflation rate/);
  assert.match(html, /-0\.20%/);
  assert.match(html, /\+0\.30%/);
  assert.match(html, /Basket weight/);
  assert.match(html, /5\.00%/);
  assert.match(html, /Flexible-price components/);
  assert.match(html, /-0\.01 pp/);
  assert.doesNotMatch(html, /class="release-components-table/);
  assert.match(html, /data-missing/);
  assert.match(html, /Higher/);
  assert.match(html, /Lower/);
});

test("unclassified rate-only baskets do not invent sticky labels or contributions", () => {
  const unclassified = {...row, classification: "unclassified" as const, effectHistory: undefined};
  const html = renderToStaticMarkup(<ReleaseDriverReport title="PCE" period="2026-09" mode="mom" rows={[unclassified]} effects={false} note="Test" />);
  assert.match(html, /Unclassified components/);
  assert.match(html, /Weighted component effects are unavailable/);
  assert.doesNotMatch(html, /Sticky-price components/);
  assert.doesNotMatch(html, /\+0\.01 pp/);
});

test("retail heatmap uses the chosen YoY sales change, not an inflation label", () => {
  const html = renderToStaticMarkup(<ReleaseDriverReport title="Retail sales" period="2026-09" mode="yoy" rows={[row]} effects={false} rateLabel="Sales change" note="Test" />);
  assert.match(html, /YoY sales change/);
  assert.doesNotMatch(html, /YoY inflation rate/);
});

test("US CPI YoY component history discloses its seasonally adjusted basis", () => {
  const html = renderToStaticMarkup(<ReleaseDriverReport title="CPI" period="2026-09" mode="yoy" rows={[row]} effects classified note="Test" />);
  assert.match(html, /component YoY rates use seasonally adjusted indexes/);
});
