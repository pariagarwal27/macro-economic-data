import assert from "node:assert/strict";
import { inflationRateHistory } from "../src/lib/inflation-rate-history.ts";

const indexHistory = [
  { date: "2025-08-01", value: 100 },
  { date: "2025-09-01", value: 101 },
  { date: "2026-07-01", value: 101.5 },
  { date: "2026-08-01", value: 102 },
  { date: "2026-09-01", value: 103.02 },
];

const yoy = inflationRateHistory([], "pct_change_yoy", indexHistory, "index", "yoy");
assert.equal(yoy[0].value, null);
assert.equal(yoy[1].value, null);
assert.ok(Math.abs(yoy.find(point => point.date === "2026-08-01").value - 2) < 1e-10
  && Math.abs(yoy.find(point => point.date === "2026-09-01").value - 2) < 1e-10,
  "an empty published YoY series falls back to rates derived from the index");

const mom = inflationRateHistory([], "pct_change_mom", indexHistory, "index", "mom");
assert.ok(Math.abs(mom.at(-2).value - ((102 / 101.5 - 1) * 100)) < 1e-10
  && Math.abs(mom.at(-1).value - ((103.02 / 102 - 1) * 100)) < 1e-10,
  "an empty published MoM series falls back to one-month index changes");

const published = inflationRateHistory(
  [{ date: "2026-09-01", value: 2.6 }],
  "pct_change_yoy",
  indexHistory,
  "index",
  "yoy",
);
assert.equal(published.find(point => point.date === "2026-09-01").value, 2.6,
  "published rates remain preferred when available");

const partialPublished = inflationRateHistory(
  [{ date: "2026-08-01", value: 1.9 }],
  "pct_change_yoy",
  indexHistory,
  "index",
  "yoy",
);
assert.equal(partialPublished.find(point => point.date === "2026-08-01").value, 1.9);
assert.ok(Math.abs(partialPublished.at(-1).value - 2) < 1e-10,
  "a published rate history missing the newest month is filled from the index history");

console.log("inflation rate history fallback tests passed");
