import assert from "node:assert/strict";
import { test } from "node:test";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const archive = new AdmZip();
const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ["quarter", "date", "value", "value", "value"],
  ["statistic", "", "Mean", "Mean", "Mean"],
  ["", "", "Selling prices", "Wages of current employees", "Non-labour input costs"],
  ["Q2 2026", new Date(Date.UTC(2026, 5, 1)), 3.173, 2.548, 5.192],
  ["Q3 2026", new Date(Date.UTC(2026, 8, 1)), 7.1, 4.7, 6.4],
  [
    "future placeholder",
    new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)),
    2.86,
    3.09,
    3.64,
  ],
]);
XLSX.utils.book_append_sheet(workbook, sheet, "Expectations");
archive.addFile("safe.xlsx", XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

test("SAFE fetcher finds renamed expectation measures outside the former Chart 14 tab", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(archive.toBuffer(), {
      status: 200,
      headers: { "Content-Type": "application/zip" },
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const {
    fetchEcbSafeSellingPriceExpectations,
    fetchEcbSafeWageExpectations,
    fetchEcbSafeInputCostExpectations,
  } = await import("./ecb-safe.ts");

  assert.deepEqual((await fetchEcbSafeSellingPriceExpectations()).at(-1), {
    date: "2026-09-01",
    value: 7.1,
  });
  assert.deepEqual((await fetchEcbSafeWageExpectations()).at(-1), {
    date: "2026-09-01",
    value: 4.7,
  });
  assert.deepEqual((await fetchEcbSafeInputCostExpectations()).at(-1), {
    date: "2026-09-01",
    value: 6.4,
  });
});
