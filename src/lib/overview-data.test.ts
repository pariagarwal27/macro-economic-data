import assert from "node:assert/strict";
import test from "node:test";

test("overview monthly chart follows the latest available observation back twelve months", async () => {
  const { buildOverviewSeries } = await import("./overview-data");
  const history = [
    { date: "2025-07-01", value: 100 },
    { date: "2025-08-01", value: 101 },
    { date: "2026-07-01", value: 112 },
    { date: "2026-08-01", value: 113 },
  ];
  const chart = buildOverviewSeries({ "us-cpi": { history, meta: { unit: "index" } } }, "inflation", new Date("2026-10-13T12:00:00Z"));

  assert.equal(chart.length, 13);
  assert.equal(chart[0]?.period, "2025-08");
  assert.equal(chart.at(-1)?.period, "2026-08");
  assert.equal(chart.find(point => point.period === "2025-07")?.US, undefined);
});

test("non-inflation overview series retain older observations for the year-range picker", async () => {
  const { buildOverviewSeries } = await import("./overview-data");
  const chart = buildOverviewSeries({ "us-unemployment": { history: [
    { date: "2023-01-01", value: 4.2 },
    { date: "2025-10-01", value: 4.1 },
    { date: "2026-10-01", value: 4.3 },
  ] } }, "unemployment", new Date("2026-10-13T12:00:00Z"));

  assert.equal(chart[0]?.date, "2023-01-01");
  assert.equal(chart.find(point => point.period === "2023-01")?.US, 4.2);
});

test("unemployment axes scale US and UK separately from the Euro Area series", async () => {
  const { overviewAxisDomain, overviewRegionAxisTicks } = await import("./overview-data");
  const data = [
    { date: "2026-01-01", period: "2026-01", label: "Jan", US: 4.3, UK: 4.9, EA: 6.3 },
    { date: "2026-02-01", period: "2026-02", label: "Feb", US: 4.4, UK: 5.0, EA: 6.4 },
    { date: "2026-03-01", period: "2026-03", label: "Mar", US: 4.1, UK: 4.9, EA: 6.5 },
  ];
  const left = overviewAxisDomain(overviewRegionAxisTicks(data, ["US", "UK"]));
  const right = overviewAxisDomain(overviewRegionAxisTicks(data, ["EA"]));

  assert.ok(left[0] < 4.1 && left[1] > 5.0, "the left scale covers US and UK values with breathing room");
  assert.ok(right[0] < 6.3 && right[1] > 6.5, "the right scale covers Euro Area values with breathing room");
  assert.ok(left[1] - left[0] < 2 && right[1] - right[0] < 1, "each series group uses a close-fit scale to reveal changes");
});
