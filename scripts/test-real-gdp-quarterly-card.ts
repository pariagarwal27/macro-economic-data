import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestQuarterPair, quarterlyGrowthPoints } from "../src/lib/quarterly-gdp";

const history = [
  { date: "2026-04-01", value: 0.5 },
  { date: "2025-10-01", value: 0.2 },
  { date: "2026-01-01", value: 0.6 },
  { date: "2026-07-01", value: Number.NaN },
];

assert.deepEqual(quarterlyGrowthPoints(history), [
  { date: "2025-10-01", quarter: "Q4 2025", value: 0.2 },
  { date: "2026-01-01", quarter: "Q1 2026", value: 0.6 },
  { date: "2026-04-01", quarter: "Q2 2026", value: 0.5 },
]);
assert.deepEqual(latestQuarterPair(history), {
  latest: { date: "2026-04-01", quarter: "Q2 2026", value: 0.5 },
  prior: { date: "2026-01-01", quarter: "Q1 2026", value: 0.6 },
});

const hierarchy = readFileSync("src/components/macro-ui-hierarchy.ts", "utf8");
const ukCardStart = hierarchy.indexOf('id: "uk-gdp-card"');
const ukCardEnd = hierarchy.indexOf("uk-gdp-monthly-card", ukCardStart);
const ukGdpCard = hierarchy.slice(ukCardStart, ukCardEnd);
assert.ok(ukGdpCard.includes('metricId: "uk-gdp-qoq"'));
assert.ok(!ukGdpCard.includes("yoyMetricId"));
assert.ok(!ukGdpCard.includes('"uk-gdp-yoy"'));
assert.ok(hierarchy.includes('id: "ea-gdp-card", metricId: "ea-gdp-qoq", yoyMetricId: "ea-gdp-yoy"'));

const ons = readFileSync("src/ingest/ons.ts", "utf8");
assert.ok(ons.includes('IHYQ: "/economy/grossdomesticproductgdp/timeseries/ihyq/qna"'));

const dashboard = readFileSync("src/components/CountryDashboard.tsx", "utf8");
assert.ok(dashboard.includes('new Set(["us-gdp-real", "uk-gdp-qoq"])'));
assert.ok(dashboard.includes("QuarterlyGdpChart metric={root} height={height}"));
assert.ok(dashboard.includes("QuarterlyGdpChart metric={root} compact"));

process.stdout.write("PASS quarterly GDP uses latest and prior quarters, one quarter-labeled chart for US/UK, latest ONS QNA series, and leaves EA unchanged\n");
