import assert from "node:assert/strict";
import test from "node:test";

test("expectation readings discard future dates used for forecast periods", async () => {
  const { getPublishedExpectationReadingsAsOf } = await import("./expectation-series");
  const readings = [
    { date: "2026-06-01", value: 2.7 },
    { date: "2026-10-01", value: 2.85 },
    { date: "2026-11-01", value: 9.9 },
    { date: "2027-06-01", value: 8.8 },
  ];

  assert.deepEqual(
    getPublishedExpectationReadingsAsOf(readings, new Date("2026-10-23T12:00:00Z")),
    readings.slice(0, 2),
  );
});

test("annual expectations retain the current published year and exclude later years", async () => {
  const { getPublishedExpectationReadingsAsOf } = await import("./expectation-series");

  assert.deepEqual(
    getPublishedExpectationReadingsAsOf([
      { date: "2025", value: 3.3 },
      { date: "2026", value: 3.02 },
      { date: "2027", value: 8.8 },
    ], new Date("2026-10-23T12:00:00Z")),
    [{ date: "2025", value: 3.3 }, { date: "2026", value: 3.02 }],
  );
});
