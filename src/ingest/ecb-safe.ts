import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

import type { RawPoint } from "./transforms";

const SAFE_ZIP =
  "https://www.ecb.europa.eu/stats/pdf/surveys/sme/SAFE_main_series.zip";

type SafeSeries = "sellingPrice" | "wage" | "inputCost";

const SAFE_CATEGORIES: Record<SafeSeries, RegExp> = {
  sellingPrice: /selling\s*prices?/i,
  wage: /(?:wage\s*costs?|wages?\s+of\s+current\s+employees)/i,
  inputCost: /non[-\s]labou?r\s+input\s*costs?/i,
};

/**
 * Read the official SAFE workbook's survey-weighted mean expectation series.
 * The ECB changes chart numbering and wording between survey rounds, so find
 * the table by its labels across workbook sheets instead of a fixed chart tab.
 */
async function fetchSafeSeries(series: SafeSeries): Promise<RawPoint[]> {
  const response = await fetch(SAFE_ZIP, {
    headers: {
      "User-Agent": "macro-economy-tracker/1.0",
      Accept: "*/*",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("ECB SAFE zip " + response.status + " " + response.statusText);
  }

  const archive = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const workbookEntry = archive
    .getEntries()
    .find((entry) => entry.entryName.toLowerCase().endsWith(".xlsx"));
  if (!workbookEntry) throw new Error("ECB SAFE zip missing XLSX workbook");

  const workbook = XLSX.read(workbookEntry.getData(), {
    type: "buffer",
    cellDates: true,
  });
  const category = SAFE_CATEGORIES[series];
  let rows: unknown[][] | undefined;
  let categoryRow = -1;
  let valueColumn = -1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const candidateRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    for (let rowIndex = 1; rowIndex < candidateRows.length; rowIndex++) {
      const headerRow = candidateRows[rowIndex] ?? [];
      const statisticRow = candidateRows[rowIndex - 1] ?? [];
      const column = headerRow.findIndex(
        (cell, index) =>
          typeof cell === "string" &&
          category.test(cell.trim()) &&
          typeof statisticRow[index] === "string" &&
          /mean/i.test(statisticRow[index] as string),
      );
      if (column >= 0) {
        rows = candidateRows;
        categoryRow = rowIndex;
        valueColumn = column;
        break;
      }
    }
    if (rows) break;
  }
  if (!rows || categoryRow < 1 || valueColumn < 0) {
    throw new Error("ECB SAFE expectations table not found for " + series);
  }

  const points: RawPoint[] = [];
  const now = new Date();
  for (const row of rows.slice(categoryRow + 1)) {
    const observationDate = parseSafeDate(row[1]);
    const value = row[valueColumn];
    // The downloadable workbook can include rows dated after the current
    // published survey round. They are not released observations yet.
    if (
      !observationDate ||
      observationDate.getTime() > now.getTime() ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      continue;
    }
    points.push({
      date:
        observationDate.getUTCFullYear() +
        "-" +
        String(observationDate.getUTCMonth() + 1).padStart(2, "0") +
        "-01",
      value: Math.round(value * 1000) / 1000,
    });
  }

  const deduped = new Map(points.map((point) => [point.date, point]));
  const sorted = [...deduped.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (!sorted.length) {
    throw new Error("ECB SAFE expectations table has no values for " + series);
  }
  return sorted;
}

function parseSafeDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial dates are days from 1899-12-30.
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    const quarter = normalized.match(/^(\d{4})\s*[-/]?\s*Q([1-4])$/i);
    if (quarter) {
      return new Date(
        Date.UTC(Number(quarter[1]), (Number(quarter[2]) - 1) * 3, 1),
      );
    }
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

export const fetchEcbSafeSellingPriceExpectations = () =>
  fetchSafeSeries("sellingPrice");
export const fetchEcbSafeWageExpectations = () => fetchSafeSeries("wage");
export const fetchEcbSafeInputCostExpectations = () => fetchSafeSeries("inputCost");

/** Backwards-compatible alias used by older callers. */
export const fetchEcbSafeWageExpectationsLegacy = fetchEcbSafeWageExpectations;
