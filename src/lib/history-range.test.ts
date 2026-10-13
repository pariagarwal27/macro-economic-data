import assert from "node:assert/strict";
import test from "node:test";

test("history year range filters inclusively across all selected years", async () => {
  const { filterHistoryByYearRange } = await import("./history-range");
  const history = [
    { date: "2019-12-01", value: 1 },
    { date: "2020-01-01", value: 2 },
    { date: "2023-Q2", value: 3 },
    { date: "2024-12-01", value: 4 },
    { date: "2025-01-01", value: 5 },
  ];

  assert.deepEqual(
    filterHistoryByYearRange(history, 2020, 2024),
    history.slice(1, 4),
  );
});

test("available year track includes calendar years with no observations", async () => {
  const { getHistoryYears } = await import("./history-range");

  assert.deepEqual(
    getHistoryYears(["2020-01-01", "2024-01-01"]),
    [2020, 2021, 2022, 2023, 2024],
  );
});

test("range normalization keeps From no later than To", async () => {
  const { normalizeHistoryYearRange } = await import("./history-range");

  assert.deepEqual(
    normalizeHistoryYearRange({ from: 2025, to: 2022 }, [2020, 2021, 2022, 2023, 2024, 2025]),
    { from: 2025, to: 2025 },
  );
});

test("clicking a year selects the nearest range handle", async () => {
  const { getHistoryHandleForYearClick } = await import("./history-range");

  assert.equal(getHistoryHandleForYearClick(3, 3, 4, true), "from");
  assert.equal(getHistoryHandleForYearClick(5, 3, 6, true), "to");
  assert.equal(getHistoryHandleForYearClick(2, 3, 6, true), "from");
  assert.equal(getHistoryHandleForYearClick(9, 8, 9, false), null);
  assert.equal(getHistoryHandleForYearClick(8, 8, 9, false), "from");
});

test("initial view plots the latest year with handles on the prior and latest years", async () => {
  const { getInitialHistoryHandleRange, getInitialHistoryPlotRange } = await import("./history-range");
  const years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

  assert.deepEqual(getInitialHistoryHandleRange(years), { from: 2025, to: 2026 });
  assert.deepEqual(getInitialHistoryPlotRange(years), { from: 2026, to: 2026 });
});

test("default chart window includes the latest observation and the same month one year earlier", async () => {
  const { filterHistoryToTrailing12Months } = await import("./history-range");
  const history = [
    { date: "2025-07-01", value: 1 },
    { date: "2025-08-01", value: 2 },
    { date: "2025-09-01", value: 3 },
    { date: "2026-08-01", value: 4 },
    { date: "2026-09-01", value: 5 },
  ];

  assert.deepEqual(filterHistoryToTrailing12Months(history), history.slice(2, 5));
});

test("default chart window works for weekly and quarterly date keys", async () => {
  const { filterHistoryToTrailing12Months } = await import("./history-range");
  const weekly = ["2025-08-13", "2025-08-14", "2025-08-15", "2026-08-07", "2026-08-14"].map((date, value) => ({ date, value }));
  const quarterly = ["2025-Q2", "2025-Q3", "2026-Q2", "2026-Q3"].map((date, value) => ({ date, value }));

  assert.deepEqual(filterHistoryToTrailing12Months(weekly), weekly.slice(1));
  assert.deepEqual(filterHistoryToTrailing12Months(quarterly), quarterly.slice(1, 4));
});
