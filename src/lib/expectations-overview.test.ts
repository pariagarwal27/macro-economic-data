import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExpectationsOverviewSeries,
  EXPECTATIONS_OVERVIEW_CATEGORIES,
  expectationsOverviewMetricIds,
} from "./expectations-overview";

test("only exposes expectation categories with a matched measure in all three regions", () => {
  assert.deepEqual(EXPECTATIONS_OVERVIEW_CATEGORIES.map(category => category.id), [
    "consumer",
    "business",
    "professional",
    "market",
  ]);
  assert.equal(new Set(expectationsOverviewMetricIds()).size, 12);
});

test("builds one comparable country line per category, normalizing dates to months", () => {
  const data = buildExpectationsOverviewSeries({
    "us-nyfed-sce-1y": { history: [{ date: "2026-01-01", value: 3 }, { date: "2026-02-01", value: 3.1 }] },
    "uk-inflation-exp-1y": { history: [{ date: "2026-Q1", value: 3.5 }] },
    "ea-ces-inflation-exp-1y": { history: [{ date: "2026-01-15", value: 2.4 }, { date: "2026-01-30", value: 2.5 }] },
  }, "consumer", new Date("2026-03-15T12:00:00Z"));

  assert.deepEqual(data, [
    { date: "2026-01-01", period: "2026-01", label: "Jan ’26", US: 3, UK: null, EA: 2.5 },
    { date: "2026-02-01", period: "2026-02", label: "Feb ’26", US: 3.1, UK: null, EA: null },
    { date: "2026-03-01", period: "2026-03", label: "Mar ’26", US: null, UK: 3.5, EA: null },
  ]);
});

test("does not include future months or non-finite readings in the overview chart", () => {
  const data = buildExpectationsOverviewSeries({
    "us-nyfed-sce-1y": { history: [
      { date: "2026-02-01", value: Number.NaN },
      { date: "2026-03-01", value: 3.2 },
      { date: "2026-04-01", value: 3.4 },
    ] },
  }, "consumer", new Date("2026-03-15T12:00:00Z"));

  assert.deepEqual(data, [{ date: "2026-03-01", period: "2026-03", label: "Mar ’26", US: 3.2, UK: null, EA: null }]);
});

test("keeps older expectation observations available to the year-range picker", () => {
  const data = buildExpectationsOverviewSeries({
    "us-nyfed-sce-1y": { history: [{ date: "2020-04-01", value: 2.4 }, { date: "2026-03-01", value: 3.2 }] },
  }, "consumer", new Date("2026-03-15T12:00:00Z"));

  assert.equal(data[0]?.date, "2020-04-01");
  assert.equal(data.at(-1)?.date, "2026-03-01");
});
