import * as XLSX from "xlsx";
import type { RawPoint } from "./transforms";
import { isFreshReleaseFetch } from "./release-fetch-context.js";

const WORKBOOK_URL = "https://www.atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/datafiles/chcs/wage-growth-tracker/wage-growth-data.xlsx";
const SHEET = "data_overall";
const HEADER_ROW = 1;
const DATE_COLUMN = 0;
const OVERALL_COLUMN = 1;

let cached: { fetchedAt: number; points: RawPoint[] } | null = null;
let request: Promise<RawPoint[]> | null = null;

/** Parse Atlanta Fed's published 3-month overall unweighted series. */
export function parseAtlantaWageTrackerWorkbook(bytes: Buffer | Uint8Array): RawPoint[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(bytes), { type: "buffer", cellDates: true });
  } catch {
    throw new Error("Atlanta Fed Wage Growth Tracker download is not a readable workbook");
  }

  const sheet = workbook.Sheets[SHEET];
  if (!sheet) throw new Error(`Atlanta Fed workbook is missing the ${SHEET} sheet`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  if (String(rows[HEADER_ROW]?.[OVERALL_COLUMN] ?? "").trim() !== "Overall") {
    throw new Error("Atlanta Fed workbook's Overall series column could not be verified");
  }

  const points = rows.slice(HEADER_ROW + 1).flatMap((row): RawPoint[] => {
    const date = normalizeDate(row[DATE_COLUMN]);
    const value = typeof row[OVERALL_COLUMN] === "number" ? row[OVERALL_COLUMN] : Number(row[OVERALL_COLUMN]);
    return date && row[OVERALL_COLUMN] !== null && Number.isFinite(value) ? [{ date, value }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));

  if (!points.length) throw new Error("Atlanta Fed workbook contains no Overall observations");
  return points;
}

export async function fetchAtlantaWageTracker(): Promise<RawPoint[]> {
  if (!isFreshReleaseFetch() && cached && Date.now() - cached.fetchedAt < 15_000) return cached.points;
  if (request) return request;
  request = (async () => {
    const response = await fetch(WORKBOOK_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
        "User-Agent": "MacroHub/1.0",
      },
    });
    if (!response.ok) throw new Error(`Atlanta Fed Wage Growth Tracker workbook HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error("Atlanta Fed Wage Growth Tracker response is not an XLSX workbook");
    }
    const points = parseAtlantaWageTrackerWorkbook(bytes);
    cached = { fetchedAt: Date.now(), points };
    return points;
  })();
  try {
    return await request;
  } finally {
    request = null;
  }
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return normalizeDate(date);
  }
  const match = String(value ?? "").trim().match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-01` : null;
}
