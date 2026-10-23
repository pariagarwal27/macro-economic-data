import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseAtlantaStickyWorkbook, fetchAtlantaStickyCpi } from "./atlanta-sticky-cpi.ts";
import { withFreshReleaseFetch } from "./release-fetch-context.js";
import { parseClevelandCpiCsv } from "./cleveland-cpi-measures.ts";
import { parseMedianPceCsv, parseDallasTrimmedMeanWorkbook } from "./us-pce-underlying.ts";
import { LIVE_MAP } from "../catalog/live-map.ts";
import { cpiUnderlyingScheduleRows, cpiReleaseCandidates } from "./cpi-release-schedule.ts";
import { METRICS } from "../catalog/metrics.ts";

test("parses all Atlanta 12-month measures", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Sticky CPI 12-month", "Core Sticky CPI 12-month", "Flexible CPI 12-month"],
    ["2025-01-01", 3.1, 2.9, 2.0],
    ["2025-02-01", 3.2, 3.0, 2.1],
  ]);
  const bytes = XLSX.write({ SheetNames: ["Data"], Sheets: { Data: sheet } }, { type: "buffer", bookType: "xlsx" });
  const parsed = parseAtlantaStickyWorkbook(bytes);
  assert.deepEqual(Object.keys(parsed), ["us-sticky-cpi", "us-core-sticky-cpi", "us-flexible-cpi"]);
  assert.deepEqual(parsed["us-sticky-cpi"], [{ date: "2025-01-01", value: 3.1 }, { date: "2025-02-01", value: 3.2 }]);
});

test("parses the publishers' one-month underlying CPI readings separately", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Date", "Sticky CPI 12-month", "Sticky CPI 1-month", "Core Sticky CPI 12-month", "Core Sticky CPI 1-month", "Flexible CPI 12-month", "Flexible CPI 1-month"],
    ["2025-01-01", 3.1, 0.2, 2.9, 0.1, 2.0, 0.3],
  ]);
  const bytes = XLSX.write({ SheetNames: ["Data"], Sheets: { Data: sheet } }, { type: "buffer", bookType: "xlsx" });
  const parsed = parseAtlantaStickyWorkbook(bytes);
  assert.ok(Math.abs(parsed["us-sticky-cpi-mom"][0].value - 0.01665) < 0.00001);
  assert.ok(Math.abs(parsed["us-core-sticky-cpi-mom"][0].value - 0.00833) < 0.00001);
  assert.ok(Math.abs(parsed["us-flexible-cpi-mom"][0].value - 0.02497) < 0.00001);
});

test("parses the Atlanta Fed's current grouped workbook layout", () => {
  const header = ["Date", "Flexible CPI (monthly)", "1-mo annualized percent change", "3-mo a.r.", "12mo", "Core Flexible CPI (monthly)", "1-mo annualized percent change", "3-mo a.r.", "12mo", "Sticky CPI (monthly)", "1-mo annualized percent change", "3-mo a.r.", "12mo", "Core Sticky CPI (monthly)", "1-mo annualized percent change", "3-mo a.r.", "12mo"];
  const row = ["2026-09-01", 0.01, 22.2, 8.1, 6.1, 0.01, 8, 3, 4, 0.01, 3.4, 3.3, 2.8, 0.01, 3.5, 3.3, 2.8];
  const sheet = XLSX.utils.aoa_to_sheet([header, row]);
  const bytes = XLSX.write({ SheetNames: ["Data"], Sheets: { Data: sheet } }, { type: "buffer", bookType: "xlsx" });
  const parsed = parseAtlantaStickyWorkbook(bytes);
  assert.equal(parsed["us-flexible-cpi"][0].value, 6.1);
  assert.equal(parsed["us-sticky-cpi"][0].value, 2.8);
  assert.equal(parsed["us-core-sticky-cpi"][0].value, 2.8);
  assert.ok(Math.abs(parsed["us-flexible-cpi-mom"][0].value - 1.684) < 0.002);
  assert.ok(Math.abs(parsed["us-sticky-cpi-mom"][0].value - 0.279) < 0.002);
});

test("rejects an Atlanta response missing a requested series", () => {
  const sheet = XLSX.utils.aoa_to_sheet([["Date", "Sticky CPI 12-month"], ["2025-01-01", 3.1]]);
  const bytes = XLSX.write({ SheetNames: ["Data"], Sheets: { Data: sheet } }, { type: "buffer", bookType: "xlsx" });
  assert.throws(() => parseAtlantaStickyWorkbook(bytes), /Core Sticky CPI/);
});

test("parses Cleveland Median CPI history as published 12-month rates", () => {
  const parsed = parseClevelandCpiCsv("Date,1-month,12-month\nJan-2025,0.3,3.1\nFeb-2025,0.2,3.2", "us-cleveland-median-cpi");
  assert.deepEqual(parsed, [{ date: "2025-01-01", value: 3.1 }, { date: "2025-02-01", value: 3.2 }]);
});

test("parses Cleveland Trimmed-Mean CPI history", () => {
  const parsed = parseClevelandCpiCsv("Date,Monthly,Past 12 months\nJan-2025,0.3,2.8", "us-cleveland-trimmed-cpi");
  assert.deepEqual(parsed, [{ date: "2025-01-01", value: 2.8 }]);
});

test("parses Cleveland one-month rates independently from 12-month rates", () => {
  const parsed = parseClevelandCpiCsv("Date,1-month,12-month\nJan-2025,0.3,2.8\nFeb-2025,-0.1,2.7", "us-cleveland-trimmed-cpi-mom");
  assert.deepEqual(parsed, [{ date: "2025-01-01", value: 0.3 }, { date: "2025-02-01", value: -0.1 }]);
});

test("parses Cleveland's official monthly-change CSV and derives YoY from the trailing 12 monthly changes", () => {
  const rows = ["date ,mcpi_monthly_chg,mcpi_ann_monthly_chg"];
  for (let month = 1; month <= 12; month++) rows.push(`${month}/1/2026,${month === 12 ? 0.003 : 0.002},${month === 12 ? 3.7 : 2.4}`);
  const csv = rows.join("\n");
  const mom = parseClevelandCpiCsv(csv, "us-cleveland-median-cpi-mom");
  const yoy = parseClevelandCpiCsv(csv, "us-cleveland-median-cpi");
  assert.ok(Math.abs(mom.at(-1).value - 0.3) < 1e-9);
  assert.ok(Math.abs(yoy.at(-1).value - ((1.002 ** 11 * 1.003 - 1) * 100)) < 1e-9);
});

test("rejects malformed Cleveland downloads", () => {
  assert.throws(() => parseClevelandCpiCsv("not a data file", "us-cleveland-median-cpi"), /date|12.month/i);
});

test("routes all five underlying measures to their publisher adapters", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(LIVE_MAP).filter(([id]) => id.includes("sticky-cpi") || id.includes("flexible-cpi") || id.includes("cleveland-median-cpi") || id.includes("cleveland-trimmed-cpi")).map(([id, ref]) => [id, ref.provider])), {
    "us-sticky-cpi": "atlanta_sticky", "us-core-sticky-cpi": "atlanta_sticky", "us-flexible-cpi": "atlanta_sticky",
    "us-cleveland-median-cpi": "cleveland_cpi", "us-cleveland-trimmed-cpi": "cleveland_cpi",
    "us-sticky-cpi-mom": "atlanta_sticky", "us-core-sticky-cpi-mom": "atlanta_sticky", "us-flexible-cpi-mom": "atlanta_sticky",
    "us-cleveland-median-cpi-mom": "cleveland_cpi", "us-cleveland-trimmed-cpi-mom": "cleveland_cpi",
  });
  const ids = ["us-sticky-cpi", "us-core-sticky-cpi", "us-flexible-cpi", "us-cleveland-median-cpi", "us-cleveland-trimmed-cpi", "us-sticky-cpi-mom", "us-core-sticky-cpi-mom", "us-flexible-cpi-mom", "us-cleveland-median-cpi-mom", "us-cleveland-trimmed-cpi-mom"];
  for (const id of ids) {
    const metric = METRICS.find(item => item.id === id);
    assert.equal(METRICS.filter(item => item.id === id).length, 1, `${id} must occur once in the catalog`);
    assert.equal(metric?.source, id.startsWith("us-cleveland") ? "cleveland" : "atlanta", `${id} must use its publisher in the catalog`);
    assert.equal(metric?.frequency, "monthly", `${id} must be available to the monthly dashboard`);
    assert.equal(metric?.transform, "published_rate", `${id} must retain the publisher's published rate`);
  }
});

test("schedules all five underlying CPI measures on confirmed CPI date", () => {
  const rows = cpiUnderlyingScheduleRows({ nextReleaseDate: "2026-11-12", nextReleaseAt: null });
  assert.equal(rows.length, 5, "calendar should show one row per measure, not duplicate MoM rows");
  assert.ok(rows.every(row => row.nextReleaseDate === "2026-11-12" && row.nextReleaseAt));
  assert.deepEqual(cpiReleaseCandidates([{ metricId: "us-cpi", nextReleaseDate: "2026-10-15", nextReleaseAt: "2026-10-15T12:30:00.000Z" }], new Date("2026-10-15T18:00:00.000Z")).filter(row => row.metricId.includes("sticky-cpi") || row.metricId.includes("flexible-cpi") || row.metricId.includes("cleveland-" )).length, 10);
  assert.deepEqual(cpiUnderlyingScheduleRows({ nextReleaseDate: null, nextReleaseAt: null }), []);
});

test("release retries request a fresh Atlanta workbook instead of replaying cached readings", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Date", "Sticky CPI 12-month", "Core Sticky CPI 12-month", "Flexible CPI 12-month"],
    ["2026-09-01", 2.8, 2.8, 6.1],
  ]), "History");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    return String(url).endsWith("stickyprice.xlsx")
      ? new Response(bytes)
      : new Response('<a href="/stickprice/stickyprice.xlsx">Data</a>');
  };
  try {
    await withFreshReleaseFetch(() => fetchAtlantaStickyCpi("us-sticky-cpi"));
    await withFreshReleaseFetch(() => fetchAtlantaStickyCpi("us-sticky-cpi"));
    assert.equal(calls, 4, "each sequential release attempt must fetch both the official page and workbook");
    await fetchAtlantaStickyCpi("us-sticky-cpi");
    assert.equal(calls, 4, "ordinary history requests can still reuse the provider snapshot");
  } finally { globalThis.fetch = originalFetch; }
});

test("parses Cleveland Fed Median PCE official monthly and 12-month CSV rates", () => {
  const csv = "Date,\"Median PCE Inflation, monthly percent change\",\"Median PCE Inflation, year-over-year percent change\"\n01/01/2025,0.3,3.1\n02/01/2025,0.2,3.2";
  assert.deepEqual(parseMedianPceCsv(csv, "mom"), [{ date: "2025-01-01", value: 0.3 }, { date: "2025-02-01", value: 0.2 }]);
  assert.deepEqual(parseMedianPceCsv(csv, "yoy"), [{ date: "2025-01-01", value: 3.1 }, { date: "2025-02-01", value: 3.2 }]);
});

test("parses Dallas Fed historical workbook and converts its annualized one-month rate", () => {
  const sheet = XLSX.utils.aoa_to_sheet([["", "", "", "", "Trimmed mean PCE inflation rates"], ["", "", "", "", "All series are at annual rates"], [], ["", "1-month", "6-month", "12-month"], ["Jan-25", 3.0, 2.8, 2.8]]);
  const bytes = XLSX.write({ SheetNames: ["History"], Sheets: { History: sheet } }, { type: "buffer", bookType: "xlsx" });
  assert.deepEqual(parseDallasTrimmedMeanWorkbook(bytes, "yoy"), [{ date: "2025-01-01", value: 2.8 }]);
  assert.ok(Math.abs(parseDallasTrimmedMeanWorkbook(bytes, "mom")[0].value - (Math.pow(1.03, 1 / 12) - 1) * 100) < 1e-9);
});

test("routes and catalogs both official PCE measures with monthly counterparts", () => {
  const ids = ["us-cleveland-median-pce", "us-cleveland-median-pce-mom", "us-dallas-trimmed-mean-pce", "us-dallas-trimmed-mean-pce-mom"];
  for (const id of ids) {
    const metric = METRICS.find(item => item.id === id);
    assert.ok(metric, id + " must be backfillable");
    assert.equal(metric.frequency, "monthly");
    assert.equal(metric.transform, "published_rate");
    assert.equal(LIVE_MAP[id].provider, id.includes("dallas") ? "dallas_pce" : "cleveland_cpi");
  }
});
