import * as XLSX from "xlsx";
import type { RawPoint } from "./transforms";

const BASE = "https://www.philadelphiafed.org";

const PAGE_BY_SERIES: Record<string, string> = {
  CPI: "/surveys-and-data/cpi-spf",
  CORECPI: "/surveys-and-data/corecpi-spf",
  PCE: "/surveys-and-data/pce",
  COREPCE: "/surveys-and-data/corepce-spf",
  CPI5YR: "/surveys-and-data/cpi5yr",
  PCE5YR: "/surveys-and-data/pce5yr",
  CPI10: "/surveys-and-data/cpi10",
  PCE10: "/surveys-and-data/pce10",
  CPI05YF05: "/surveys-and-data/cpi05yf05",
  PCE05YF05: "/surveys-and-data/pce05yf05",
};

function quarterDate(year: number, quarter: number) {
  const month = (quarter - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function findMeanWorkbookUrl(html: string, seriesId: string) {
  const hrefs = [...html.matchAll(/href=["']([^"']+\.xlsx(?:\?[^"']*)?)["']/gi)]
    .map((m) => m[1]);

  const mean = hrefs.find((href) => /mean/i.test(href));
  if (mean) return new URL(mean, BASE).toString();

  const filename = `Mean_${seriesId}_Level.xlsx`;
  return `${BASE}/-/media/FRBP/Assets/Surveys-And-Data/survey-of-professional-forecasters/data-files/files/${filename}`;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function chooseValueColumn(headers: unknown[], seriesId: string) {
  const normalized = headers.map(normalizeHeader);
  const exact = normalized.findIndex((h) => h === seriesId.toUpperCase());
  if (exact >= 0) return exact;

  // SPF mean level files use quarterly forecast horizons. A one-year-ahead
  // forecast is four quarters ahead, so prefer the 4-quarter column.
  const oneYear = normalized.findIndex(
    (h) => h === `${seriesId}4` || h === `${seriesId}_4` || h === `${seriesId}Q4`
  );
  if (oneYear >= 0) return oneYear;

  const prefix = normalized.findIndex((h) => h.startsWith(seriesId.toUpperCase()));
  if (prefix >= 0) return prefix;

  return -1;
}

export async function fetchPhiladelphiaLatest(
  seriesId: string,
  signal?: AbortSignal
) {
  const pagePath = PAGE_BY_SERIES[seriesId];
  if (!pagePath) throw new Error(`No Philadelphia SPF page for ${seriesId}`);

  const pageRes = await fetch(`${BASE}${pagePath}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "text/html", "User-Agent": "MacroHub/1.0" },
  });
  if (!pageRes.ok) throw new Error(`Philadelphia SPF page HTTP ${pageRes.status}`);

  const html = await pageRes.text();
  const workbookUrl = findMeanWorkbookUrl(html, seriesId);

  const fileRes = await fetch(workbookUrl, {
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "User-Agent": "MacroHub/1.0",
    },
  });
  if (!fileRes.ok) throw new Error(`Philadelphia SPF workbook HTTP ${fileRes.status}`);

  const workbook = XLSX.read(Buffer.from(await fileRes.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`Philadelphia SPF workbook has no sheet for ${seriesId}`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const headerIndex = rows.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => normalizeHeader(cell) === seriesId.toUpperCase())
  );
  const hIndex = headerIndex >= 0 ? headerIndex : rows.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => normalizeHeader(cell) === "YEAR")
  );
  if (hIndex < 0) throw new Error(`Philadelphia SPF header not found for ${seriesId}`);

  const headers = rows[hIndex] as unknown[];
  const valueIndex = chooseValueColumn(headers, seriesId);
  if (valueIndex < 0) {
    throw new Error(`Philadelphia SPF value column not found for ${seriesId}`);
  }

  const yearIndex = headers.findIndex((h) => normalizeHeader(h) === "YEAR");
  const quarterIndex = headers.findIndex((h) => normalizeHeader(h) === "QUARTER");
  if (yearIndex < 0 || quarterIndex < 0) {
    throw new Error(`Philadelphia SPF YEAR/QUARTER columns not found for ${seriesId}`);
  }

  const points: RawPoint[] = [];
  for (let i = hIndex + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const year = Number(row[yearIndex]);
    const quarter = Number(row[quarterIndex]);
    const value = Number(row[valueIndex]);
    if (!Number.isFinite(year) || !Number.isFinite(quarter) || !Number.isFinite(value)) continue;
    if (quarter < 1 || quarter > 4) continue;
    points.push({ date: quarterDate(year, quarter), value });
  }

  if (!points.length) throw new Error(`Philadelphia SPF returned no numeric ${seriesId} observations`);

  const latest = points.sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
  return {
    periodDate: latest.date,
    value: latest.value,
    rawValue: latest.value,
    releasedAt: new Date().toISOString(),
    note: `Official Philadelphia Fed SPF ${seriesId}`,
  };
}
