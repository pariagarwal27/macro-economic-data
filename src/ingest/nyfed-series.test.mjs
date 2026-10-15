import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { fetchNyfedSeries } from "./nyfed.ts";

function mockNyfedWorkbook(t, sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes, {
    status: 200,
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  t.after(() => { globalThis.fetch = originalFetch; });
}

test("job loss reads NY Fed's mean probability of losing a job column", async (t) => {
  mockNyfedWorkbook(t, [
    ["Unrelated series", [
      ["Probability of a job separation"],
      [null],
      [null, "Probability of a job separation"],
      [202609, 31.38017272949219],
    ]],
    ["Job separation expectation", [
      ["Source: Federal Reserve Bank of New York"],
      ["Job separation expectations"],
      [null],
      [null, "Mean probability of losing a job", "Mean probability of leaving a job voluntarily"],
      [202609, 13.517749786376953, 19.864971160888672],
    ]],
  ]);

  const series = await fetchNyfedSeries("SCE_LABOR_JOB_SEPARATION_1Y");
  assert.deepEqual(series.at(-1), { date: "2026-09-01", value: 13.517749786376953 });
});

test("job finding reads NY Fed's three-month job-finding probability column", async (t) => {
  mockNyfedWorkbook(t, [
    ["Unrelated series", [
      ["Probability of finding a job"],
      [null],
      [null, "Probability of finding a job"],
      [202609, 6.759451389312744],
    ]],
    ["Job finding expectations", [
      ["Source: Federal Reserve Bank of New York"],
      ["Job finding expectations"],
      [null],
      [null, "Mean probability of finding a job in the next three months if one loses a job today"],
      [202609, 46.1146240234375],
    ]],
  ]);

  const series = await fetchNyfedSeries("SCE_LABOR_JOB_FINDING_1Y");
  assert.deepEqual(series.at(-1), { date: "2026-09-01", value: 46.1146240234375 });
});

test("job finding release fallback accepts the NY Fed's published 'percent' wording", async (t) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["No matching data"]]), "Notes");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const responses = [
    new Response(bytes),
    new Response('<a href="/newsevents/news/research/2026/20261007">September SCE</a>'),
    new Response("Released the September 2026 Survey of Consumer Expectations. The mean perceived probability of finding a job if one's current job was lost increased by 0.7 percentage point to 46.1 percent."),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => responses.shift();
  t.after(() => { globalThis.fetch = originalFetch; });

  const series = await fetchNyfedSeries("SCE_LABOR_JOB_FINDING_1Y");
  assert.deepEqual(series, [{ date: "2026-09-01", value: 46.1 }]);
});

test("inflation horizons parse from the current combined NY Fed worksheet", async (t) => {
  mockNyfedWorkbook(t, [
    ["Inflation expectations", [
      ["Source: Federal Reserve Bank of New York"],
      ["Inflation expectations"],
      [null],
      [
        null,
        "Median one-year ahead expected inflation rate",
        "Median three-year ahead expected inflation rate",
        "25th Percentile five-year ahead expected inflation rate",
        "Median five-year ahead expected inflation rate",
        "75th Percentile five-year ahead expected inflation rate",
        "Median point prediction five-year ahead inflation rate",
      ],
      [202608, 3.6, 3.1, 1.5, 3.0, 4.8, 3.2],
      [202609, 3.9, 3.3, 1.4, 3.0, 4.7, 3.1],
    ]],
  ]);

  for (const [seriesId, expected] of [
    ["SCE_INFLATION_1Y", 3.9],
    ["SCE_INFLATION_3Y", 3.3],
    ["SCE_INFLATION_5Y", 3.0],
  ]) {
    const series = await fetchNyfedSeries(seriesId);
    assert.deepEqual(series.at(-1), { date: "2026-09-01", value: expected });
  }
});

test("an absent 5Y column does not make the available 1Y series fail", async (t) => {
  mockNyfedWorkbook(t, [
    ["Inflation expectations", [
      [null],
      [null],
      [null],
      [null, "Median one-year ahead expected inflation rate", "Median three-year ahead expected inflation rate"],
      [202609, 3.9, 3.3],
    ]],
  ]);

  const series = await fetchNyfedSeries("SCE_INFLATION_1Y");
  assert.deepEqual(series.at(-1), { date: "2026-09-01", value: 3.9 });
});
