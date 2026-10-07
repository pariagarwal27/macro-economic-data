import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

import type { RawPoint } from "./transforms";

const SAFE_ZIP =
  "https://www.ecb.europa.eu/stats/pdf/surveys/sme/SAFE_main_series.zip";

type SafeSeries = "sellingPrice" | "wage" | "inputCost";

/**
 * Read the official SAFE Chart 14 workbook table. Each component is the
 * survey-weighted mean of firms' expectations over the next 12 months.
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
    throw new Error(`ECB SAFE zip ${response.status} ${response.statusText}`);
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
  const sheetName = workbook.SheetNames.find((name) =>
    /^chart[_ ]?14$/i.test(name.trim()),
  );
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("ECB SAFE Chart 14 worksheet could not be located");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });

  // The live ECB workbook uses a category header row and a statistic row.
  // Select the Mean column by both labels to avoid relying on column offsets.
  const category = {
    sellingPrice: "selling prices",
    wage: "wage costs",
    inputCost: "non-labour input costs",
  }[series];
  const categoryRow = rows.findIndex((row) =>
    row.some(
      (cell) => typeof cell === "string" && cell.trim().toLowerCase() === category,
    ),
  );
  if (categoryRow < 1) {
    throw new Error(`ECB SAFE Chart 14 category not found: ${category}`);
  }

  const categoryHeaders = rows[categoryRow] ?? [];
  const statistics = rows[categoryRow - 1] ?? [];
  const valueColumn = categoryHeaders.findIndex(
    (cell, index) =>
      typeof cell === "string" &&
      cell.trim().toLowerCase() === category &&
      typeof statistics[index] === "string" &&
      (statistics[index] as string).trim().toLowerCase() === "mean",
  );
  if (valueColumn < 0) {
    throw new Error(`ECB SAFE Chart 14 mean column not found for ${category}`);
  }

  const points: RawPoint[] = [];
  for (const row of rows.slice(categoryRow + 1)) {
    const dateValue = row[1];
    const value = row[valueColumn];
    if (!(dateValue instanceof Date) || typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    points.push({
      date: `${dateValue.getUTCFullYear()}-${String(dateValue.getUTCMonth() + 1).padStart(2, "0")}-01`,
      value: Math.round(value * 1000) / 1000,
    });
  }

  const deduped = new Map(points.map((point) => [point.date, point]));
  const sorted = [...deduped.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) throw new Error(`ECB SAFE Chart 14 has no values for ${category}`);
  return sorted;
}

export const fetchEcbSafeSellingPriceExpectations = () =>
  fetchSafeSeries("sellingPrice");
export const fetchEcbSafeWageExpectations = () => fetchSafeSeries("wage");
export const fetchEcbSafeInputCostExpectations = () => fetchSafeSeries("inputCost");

/** Backwards-compatible alias used by older callers. */
export const fetchEcbSafeWageExpectationsLegacy = fetchEcbSafeWageExpectations;
