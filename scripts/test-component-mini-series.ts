import assert from "node:assert/strict";
import { selectComponentMiniSeries } from "../src/lib/component-mini-series";

const history = [
  { date: "2025-01-01", value: 100 },
  { date: "2025-02-01", value: 102 },
  { date: "2026-01-01", value: 110 },
  { date: "2026-02-01", value: 111.1 },
];
const root = { meta: { id: "food-index", transform: "level", frequency: "monthly" }, history };
const publishedMom = { meta: { id: "food-mom", transform: "pct_change_mom", frequency: "monthly" }, history: [
  { date: "2026-01-01", value: 0.4 }, { date: "2026-02-01", value: 0.8 },
] };

assert.deepEqual(
  selectComponentMiniSeries({ metricId: "food-index", momMetricId: "food-mom" }, root, { "food-mom": publishedMom }, "mom"),
  { metricId: "food-mom", frequency: "monthly", data: publishedMom.history },
  "use the dedicated published MoM series when requested",
);
const derivedMom = selectComponentMiniSeries({ metricId: "food-index" }, root, {}, "mom").data;
assert.deepEqual(derivedMom.map(point => point.date), ["2025-02-01", "2026-02-01"], "derive MoM from exact prior months and leave missing months as gaps");
assert.ok(Math.abs(derivedMom[0].value - 2) < 1e-10 && Math.abs(derivedMom[1].value - 1) < 1e-10);
const derivedYoy = selectComponentMiniSeries({ metricId: "food-index" }, root, {}, "yoy").data;
assert.deepEqual(derivedYoy.map(point => point.date), ["2026-01-01", "2026-02-01"]);
assert.ok(Math.abs(derivedYoy[0].value - 10) < 1e-10 && Math.abs(derivedYoy[1].value - 8.92156862745) < 1e-9, "derive YoY for a level series when YoY is selected");
const yoyMetric = { meta: { id: "food-yoy", transform: "pct_change_yoy", frequency: "monthly" }, history: [{ date: "2026-01-01", value: 9.5 }] };
assert.equal(selectComponentMiniSeries({ metricId: "food-yoy" }, yoyMetric, {}, "yoy").data[0].value, 9.5);
const quarterlyLevel = { meta: { id: "consumption", transform: "level", frequency: "quarterly" }, history: [
  { date: "2025-03-31", value: 100 }, { date: "2025-06-30", value: 105 },
  { date: "2026-03-31", value: 110 }, { date: "2026-06-30", value: 120 },
] };
const quarterlyYoy = selectComponentMiniSeries({ metricId: "consumption" }, quarterlyLevel, {}, "yoy").data;
assert.deepEqual(quarterlyYoy.map(point => point.date), ["2026-03-31", "2026-06-30"], "quarterly YoY aligns to the same quarter last year");
assert.ok(Math.abs(quarterlyYoy[0].value - 10) < 1e-10);
console.log("PASS component mini series: dedicated and derived MoM, YoY fallback, and direct YoY series");
