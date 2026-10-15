import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { fetchClevelandExpectedInflation, fetchClevelandExpectedInflationWithFallback, parseClevelandExpectationsWorkbook } from "./cleveland-expectations.ts";

const dateSerial = (year, month) =>
  (Date.UTC(year, month - 1, 1) - Date.UTC(1899, 11, 30)) / 86_400_000;

function makeWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Model Output Date", " 1 year Expected Inflation", " 2 year Expected Inflation", " 3 year Expected Inflation", " 4 year Expected Inflation", " 5 year Expected Inflation", " 6 year Expected Inflation", " 7 year Expected Inflation", " 8 year Expected Inflation", " 9 year Expected Inflation", " 10 year Expected Inflation", " 11 year Expected Inflation", " 12 year Expected Inflation", " 13 year Expected Inflation", " 14 year Expected Inflation", " 15 year Expected Inflation", " 16 year Expected Inflation", " 17 year Expected Inflation", " 18 year Expected Inflation", " 19 year Expected Inflation", " 20 year Expected Inflation", " 21 year Expected Inflation", " 22 year Expected Inflation", " 23 year Expected Inflation", " 24 year Expected Inflation", " 25 year Expected Inflation", " 26 year Expected Inflation", " 27 year Expected Inflation", " 28 year Expected Inflation", " 29 year Expected Inflation", " 30 year Expected Inflation"],
    [dateSerial(2025, 12), ...Array.from({ length: 30 }, (_, i) => (i + 1) / 100)],
    [dateSerial(2026, 1), ...Array.from({ length: 30 }, (_, i) => (i + 2) / 100)],
  ]), "Expected Inflation");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("Cleveland workbook parser selects the requested horizon and converts decimals to percent", () => {
  const points = parseClevelandExpectationsWorkbook(makeWorkbook(), "EXPINF3YR");
  assert.deepEqual(points, [
    { date: "2025-12-01", value: 3 },
    { date: "2026-01-01", value: 4 },
  ]);
});

test("Cleveland live fetch discovers and downloads the official workbook", async (t) => {
  const workbook = makeWorkbook();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response('<a href="/-/media/files/webcharts/inflationexpectations/inflation-expectations.xlsx?sc_lang=en">Excel</a>');
    }
    return new Response(workbook);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const points = await fetchClevelandExpectedInflation("EXPINF5YR");
  assert.equal(calls[0], "https://www.clevelandfed.org/indicators-and-data/inflation-expectations");
  assert.equal(calls[1], "https://www.clevelandfed.org/-/media/files/webcharts/inflationexpectations/inflation-expectations.xlsx?sc_lang=en");
  assert.deepEqual(points.at(-1), { date: "2026-01-01", value: 6 });
});

test("Cleveland live fetch uses FRED only when the official workbook fails", async () => {
  let fallbackCalls = 0;
  const result = await fetchClevelandExpectedInflationWithFallback(
    "EXPINF1YR",
    {
      primaryFetcher: async () => { throw new Error("official workbook unavailable"); },
      fallbackFetcher: async () => {
        fallbackCalls += 1;
        return [{ date: "2026-01-01", value: 2.5 }];
      },
    }
  );

  assert.equal(fallbackCalls, 1);
  assert.deepEqual(result.points, [{ date: "2026-01-01", value: 2.5 }]);
  assert.match(result.note, /FRED fallback/);
});

test("successful Cleveland output bypasses the FRED fallback", async () => {
  let fallbackCalls = 0;
  const points = [{ date: "2026-01-01", value: 2.7 }];
  const result = await fetchClevelandExpectedInflationWithFallback("EXPINF1YR", {
    primaryFetcher: async () => points,
    fallbackFetcher: async () => {
      fallbackCalls += 1;
      return [];
    },
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(result.note, "Live Cleveland Fed model output EXPINF1YR");
  assert.deepEqual(result.points, points);
});
