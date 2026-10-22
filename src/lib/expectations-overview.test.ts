import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExpectationsOverviewSeries,
  EXPECTATIONS_OVERVIEW_CATEGORIES,
  expectationsOverviewMetricIds,
  expectationsOverviewCategory,
  expectationsOverviewHorizons,
} from "./expectations-overview";

test("only exposes expectation categories with a matched measure in all three regions", () => {
  assert.deepEqual(EXPECTATIONS_OVERVIEW_CATEGORIES.map(category => category.id), [
    "consumer",
    "business",
    "market",
    "wage",
  ]);
  assert.equal(new Set(expectationsOverviewMetricIds()).size, 17);
});

test("wage comparison plots the country wage components as published rates", () => {
  const definition = expectationsOverviewCategory("wage");
  assert.deepEqual(definition.metricIds, {
    US: "us-atlanta-wage", UK: "uk-dmp-wage-exp-1y", EA: "ea-wage-tracker",
  });
  for (const id of Object.values(definition.metricIds)) assert.ok(expectationsOverviewMetricIds().includes(id));
  assert.deepEqual(expectationsOverviewHorizons("wage"), []);
  const data = buildExpectationsOverviewSeries({
    "us-atlanta-wage": { history: [{ date: "2026-08-01", value: 4.1 }, { date: "2026-09-01", value: 3.9 }] },
    "uk-dmp-wage-exp-1y": { history: [{ date: "2026-09-01", value: 3.5 }] },
    "ea-wage-tracker": { history: [{ date: "2026-09-01", value: 2.8 }, { date: "2027-01-01", value: 3 }] },
  }, "wage", new Date("2026-10-22T12:00:00Z"));
  assert.equal(data.at(-1)?.US, 3.9);
  assert.equal(data.at(-1)?.UK, 3.5);
  assert.equal(data.at(-1)?.EA, 2.8);
  assert.equal(data.at(-1)?.date, "2026-09-01");
});

test("5Y selection uses the five-year consumer series and includes them in the API request", () => {
  const ids = ["us-nyfed-sce-5y", "uk-inflation-exp-5y", "ea-ces-inflation-exp-5y"];
  for (const id of ids) assert.ok(expectationsOverviewMetricIds().includes(id));
  const payload = Object.fromEntries([
    ...ids.map((id, index) => [id, { history: [{ date: "2026-03-01", value: 2 + index / 10 }] }]),
    ["us-nyfed-sce-1y", { history: [{ date: "2026-03-01", value: 9 }] }],
  ]);
  const data = buildExpectationsOverviewSeries(payload, "consumer", new Date("2026-04-01T12:00:00Z"), "5y");
  assert.equal(data[0]?.US, 2);
  assert.equal(data[0]?.UK, 2.1);
  assert.equal(data[0]?.EA, 2.2);
  assert.match(expectationsOverviewCategory("consumer", "5y").measure, /5Y/);
});

test("horizon options reflect available comparable measures", () => {
  assert.deepEqual(expectationsOverviewHorizons("consumer"), ["1y", "5y"]);
  assert.deepEqual(expectationsOverviewHorizons("business"), ["1y"]);
  assert.deepEqual(expectationsOverviewHorizons("market"), ["5y", "5y5y"]);
});

test("market 5Y5Y view maps US and UK forward series and keeps Euro Area 5Y", () => {
  const definition = expectationsOverviewCategory("market", "5y5y");
  assert.deepEqual(definition.metricIds, {
    US: "us-5y5y-forward",
    UK: "uk-inflation-comp-5y5y",
    EA: "ea-inflation-comp-5y",
  });
  const data = buildExpectationsOverviewSeries({
    "us-5y5y-forward": { history: [{ date: "2026-09-01", value: 2.2 }] },
    "uk-inflation-comp-5y5y": { history: [{ date: "2026-09-01", value: 3.1 }] },
    "ea-inflation-comp-5y": { history: [{ date: "2026-09-01", value: 2.4 }] },
    "us-breakeven-5y": { history: [{ date: "2026-09-01", value: 9 }] },
  }, "market", new Date("2026-10-22T12:00:00Z"), "5y5y");
  assert.deepEqual([data[0]?.US, data[0]?.UK, data[0]?.EA], [2.2, 3.1, 2.4]);
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
