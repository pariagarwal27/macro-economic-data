import assert from "node:assert/strict";
import test from "node:test";
import { formatDailyExpectationDate, getDailyExpectationRange, usesDailyExpectationWindow } from "./expectation-daily-window";

test("UK 5Y and 5Y5Y alone use the daily window", () => {
  assert.equal(usesDailyExpectationWindow(["uk-inflation-comp-5y"]), true);
  assert.equal(usesDailyExpectationWindow(["uk-inflation-comp-5y5y"]), true);
  assert.equal(usesDailyExpectationWindow(["uk-inflation-comp-1y"]), false);
  assert.equal(usesDailyExpectationWindow(["us-breakeven-5y"]), false);
});

test("default window covers 45 calendar days inclusive of the latest observation", () => {
  const dates = ["2025-01-01", "2026-09-15", "2026-09-16", "2026-10-02", "2026-10-30"];
  assert.deepEqual(getDailyExpectationRange(dates), { startIndex: 2, endIndex: 4 });
  assert.deepEqual(getDailyExpectationRange(dates, { from: "2025-01-01", to: "2026-09-15" }), { startIndex: 0, endIndex: 1 });
  assert.deepEqual(dates, ["2025-01-01", "2026-09-15", "2026-09-16", "2026-10-02", "2026-10-30"]);
});

test("short, empty, and cross-year histories remain usable", () => {
  assert.deepEqual(getDailyExpectationRange([]), { startIndex: 0, endIndex: 0 });
  assert.deepEqual(getDailyExpectationRange(["2026-10-30"]), { startIndex: 0, endIndex: 0 });
  assert.deepEqual(getDailyExpectationRange(["2025-11-30", "2025-12-01", "2026-01-14"]), { startIndex: 1, endIndex: 2 });
});

test("daily axis dates use DD/MM with leading zeroes", () => {
  assert.equal(formatDailyExpectationDate("2026-10-02"), "02/10");
  assert.equal(formatDailyExpectationDate("2026-10-23"), "23/10");
});
