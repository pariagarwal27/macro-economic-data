
import type { RawPoint } from "./transforms";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import { isFreshReleaseFetch } from "./release-fetch-context.js";
const DMP_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
function currentDmpIndex(date = new Date()) {
  const month = DMP_MONTHS[date.getUTCMonth()];
  return `https://www.bankofengland.co.uk/decision-maker-panel/${date.getUTCFullYear()}/${month}-${date.getUTCFullYear()}`;
}
const MPS_INDEX = "https://www.bankofengland.co.uk/markets/market-intelligence/survey-results";
const MPR_INDEX = "https://www.bankofengland.co.uk/sitemap/monetary-policy-report";
const BOE_DAILY_INFLATION_ARCHIVE =
  "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcinflationddata.zip";
const BOE_DAILY_INFLATION_LATEST =
  "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip";

export type DmpWageSeries =
  | "DMP_WAGE_REALISED_3M"
  | "DMP_WAGE_EXPECTED_3M"
  | "DMP_WAGE_REALISED_1M"
  | "DMP_WAGE_EXPECTED_1M";

let cachedXlsx: { url: string; buf: Buffer; at: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;
type BoeDailyInflationSeries = "UK_INFL_COMP_5Y" | "UK_INFL_COMP_10Y" | "UK_INFL_COMP_5Y5Y";
type BoeDailyInflationCurve = Record<BoeDailyInflationSeries, RawPoint[]>;
let cachedBoeDailyInflation: { curve: BoeDailyInflationCurve; at: number } | null = null;
let pendingBoeDailyInflation: Promise<BoeDailyInflationCurve> | null = null;
const BOE_DAILY_CURVE_CACHE_MS = 60 * 60 * 1000;

/**
 * Daily UK 5Y and 10Y implied inflation spot rates, plus 5Y5Y forward, from the BoE gilt curve.
 * The BoE publishes daily spot inflation zero-coupon rates at 5Y and 10Y;
 * with continuous compounding, the five-year forward rate starting in five
 * years is 2 * 10Y spot - 5Y spot. The 1Y point is not published in this
 * dataset (the daily spot curve starts at 25 months), so 1Y remains on the
 * existing monthly MPR series until a valid daily one-year source is added.
 */
export async function fetchBoeDailyInflationCompensation(
  seriesId: BoeDailyInflationSeries
): Promise<RawPoint[]> {
  const now = Date.now();
  if (cachedBoeDailyInflation && now - cachedBoeDailyInflation.at < BOE_DAILY_CURVE_CACHE_MS) {
    return cachedBoeDailyInflation.curve[seriesId];
  }
  if (!pendingBoeDailyInflation) pendingBoeDailyInflation = fetchBoeDailyInflationCurve();
  try {
    const curve = await pendingBoeDailyInflation;
    cachedBoeDailyInflation = { curve, at: Date.now() };
    const points = curve[seriesId];
    if (!points.length) throw new Error(`${seriesId} returned no daily BoE curve observations`);
    return points;
  } finally {
    pendingBoeDailyInflation = null;
  }
}

async function fetchBoeDailyInflationCurve(): Promise<BoeDailyInflationCurve> {
  const [archiveResponse, latestResponse] = await Promise.all([
    fetch(BOE_DAILY_INFLATION_ARCHIVE, {
      headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "*/*" },
    }),
    fetch(BOE_DAILY_INFLATION_LATEST, {
      headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "*/*" },
    }),
  ]);
  if (!archiveResponse.ok) throw new Error(`BoE daily inflation archive HTTP ${archiveResponse.status}`);
  if (!latestResponse.ok) throw new Error(`BoE latest yield curve HTTP ${latestResponse.status}`);

  const archive = new AdmZip(Buffer.from(await archiveResponse.arrayBuffer()));
  const recentEntry = archive.getEntries().find((entry) =>
    /GLC Inflation daily data_2025 to present\.xlsx$/i.test(entry.entryName)
  );
  if (!recentEntry) throw new Error("BoE daily inflation archive is missing its current-history workbook");

  const points = new Map<BoeDailyInflationSeries, Map<string, number>>([
    ["UK_INFL_COMP_5Y", new Map()],
    ["UK_INFL_COMP_10Y", new Map()],
    ["UK_INFL_COMP_5Y5Y", new Map()],
  ]);
  for (const [seriesId, seriesPoints] of Object.entries(parseBoeDailyInflationCurve(recentEntry.getData())) as [BoeDailyInflationSeries, RawPoint[]][]) {
    for (const point of seriesPoints) points.get(seriesId)!.set(point.date, point.value);
  }

  const latest = new AdmZip(Buffer.from(await latestResponse.arrayBuffer()));
  const latestEntry = latest.getEntries().find((entry) =>
    /GLC Inflation daily data current month\.xlsx$/i.test(entry.entryName)
  );
  if (!latestEntry) throw new Error("BoE latest yield curve ZIP is missing its inflation workbook");
  for (const [seriesId, seriesPoints] of Object.entries(parseBoeDailyInflationCurve(latestEntry.getData())) as [BoeDailyInflationSeries, RawPoint[]][]) {
    for (const point of seriesPoints) points.get(seriesId)!.set(point.date, point.value);
  }

  const curve = Object.fromEntries([...points.entries()].map(([seriesId, seriesPoints]) => [
    seriesId,
    [...seriesPoints.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
  ])) as BoeDailyInflationCurve;
  if (!curve.UK_INFL_COMP_5Y5Y.length) throw new Error("BoE daily inflation curve returned no 5Y5Y observations");
  return curve;
}

function parseBoeDailyInflationCurve(workbook: Buffer): BoeDailyInflationCurve {
  const zip = new AdmZip(workbook);
  const shared = parseSharedStrings(
    zip.getEntry("xl/sharedStrings.xml")?.getData().toString("utf8") ?? ""
  );
  const points = new Map<BoeDailyInflationSeries, Map<string, number>>([
    ["UK_INFL_COMP_5Y", new Map()],
    ["UK_INFL_COMP_10Y", new Map()],
    ["UK_INFL_COMP_5Y5Y", new Map()],
  ]);

  for (const sheet of zip.getEntries().filter((entry) =>
    /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName)
  )) {
    const rows = parseSheetRows(sheet.getData().toString("utf8"), shared);
    if (!rows.some((row) => row.some((cell) => /implied inflation spot curve/i.test(cell)))) continue;

    const header = rows.find((row) => /^years?:?$/i.test((row[0] ?? "").trim()));
    if (!header) continue;
    const fiveYearColumn = header.findIndex((cell) => {
      const value = parseNumber(cell);
      return value != null && Math.abs(value - 5) < 0.001;
    });
    const tenYearColumn = header.findIndex((cell) => {
      const value = parseNumber(cell);
      return value != null && Math.abs(value - 10) < 0.001;
    });
    if (fiveYearColumn < 0 || tenYearColumn < 0) continue;

    for (const row of rows) {
      const date = normalizeDate(row[0] ?? "");
      if (!date) continue;
      const fiveYear = parseNumber(row[fiveYearColumn] ?? "");
      const tenYear = parseNumber(row[tenYearColumn] ?? "");
      if (fiveYear == null || tenYear == null) continue;
      if (fiveYear >= -5 && fiveYear <= 15) points.get("UK_INFL_COMP_5Y")!.set(date, fiveYear);
      if (tenYear >= -5 && tenYear <= 15) points.get("UK_INFL_COMP_10Y")!.set(date, tenYear);
      const forward = 2 * tenYear - fiveYear;
      if (forward >= -5 && forward <= 15) points.get("UK_INFL_COMP_5Y5Y")!.set(date, forward);
    }
  }

  return Object.fromEntries([...points.entries()].map(([seriesId, seriesPoints]) => [
    seriesId,
    [...seriesPoints.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
  ])) as BoeDailyInflationCurve;
}

/**
 * BoE IADB IUMSIZC: end-month level of the five-year inflation zero-coupon
 * yield. This is the published 5Y spot measure and has a longer history than
 * the recent daily spreadsheet archive.
 */
export async function fetchBoeFiveYearInflationCompensation(): Promise<RawPoint[]> {
  const url = new URL("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp");
  url.search = new URLSearchParams({
    "csv.x": "yes",
    Datefrom: "01/Jan/1985",
    Dateto: "now",
    SeriesCodes: "IUMSIZC",
    CSVF: "TN",
    UsingCodes: "Y",
    VPD: "Y",
    VFD: "N",
  }).toString();
  const response = await fetch(url, {
    headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "text/csv,text/plain,*/*" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`BoE IADB IUMSIZC HTTP ${response.status}`);
  const text = (await response.text()).replace(/^\uFEFF/, "");
  const points: RawPoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = parseCsvRow(line);
    const dateCell = cells.find((cell) => /^(?:\d{1,2}[/-][A-Za-z]{3}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}|\d{4}-\d{2}(?:-\d{2})?|[A-Za-z]{3}-\d{2})$/.test(cell.trim()));
    if (!dateCell) continue;
    const date = parseBoEIadbDate(dateCell.trim());
    const valueCell = cells.find((cell) => parseNumber(cell) != null && cell.trim() !== dateCell);
    const value = valueCell == null ? null : parseNumber(valueCell);
    if (date && value != null && Number.isFinite(value)) points.push({ date, value });
  }
  const result = dedupe(points);
  if (!result.length) throw new Error("BoE IADB IUMSIZC returned no observations");
  return result;
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell.trim()); cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseBoEIadbDate(value: string): string | null {
  const date = value.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3})[\s/-]+(\d{2,4})$/);
  if (date) {
    const year = Number(date[3]);
    const fullYear = year < 100 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
    return `${fullYear}-${monthNum(date[2]!)}-01`;
  }
  return normalizeDate(value);
}

export async function fetchBoeDmpWages(seriesId: DmpWageSeries): Promise<RawPoint[]> {
  const buf = await loadLatestDmpXlsx();
  return parseDmpWageSheet(buf, seriesId);
}

/** DMP CPI / own-price / expected wage series. */
export async function fetchBoeDmpSeries(seriesId: string): Promise<RawPoint[]> {
  if (seriesId === "DMP_WAGE_EXPECTED_1Y") {
    return fetchBoeDmpWages("DMP_WAGE_EXPECTED_3M");
  }
  if (
    seriesId !== "DMP_CPI_EXPECTED_1Y" &&
    seriesId !== "DMP_CPI_EXPECTED_3Y" &&
    seriesId !== "DMP_OWN_PRICE_EXPECTED_1Y"
  ) {
    throw new Error(`Unknown DMP series ${seriesId}`);
  }

  // The monthly DMP workbook has changed sheet/column layouts over time.
  // Scan all worksheets and select the column by its semantic header rather
  // than relying on a fixed sheet number or Excel column.
  const points = await fetchDmpMonthlyHistoryByHeader(seriesId);
  if (!points.length) throw new Error(`DMP series ${seriesId} returned no observations`);
  return points;
}

/** Market Participants Survey CPI medians from the Bank's monthly survey pages. */
export async function fetchBoeMapsInflation(
  seriesId: string
): Promise<RawPoint[]> {
  const horizon = seriesId
    .replace("MAPS_CPI_", "")
    .toLowerCase();

  if (
    !["1y", "2y", "3y", "5y"].includes(horizon)
  ) {
    throw new Error(`Unknown MaPS series ${seriesId}`);
  }

  const urls = await discoverMapsPages();

  const points: RawPoint[] = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url);

      const date = parseBoEMonthDate(html, url);
      if (!date) continue;

    const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];

const wanted =
  horizon === "1y"
    ? "one year ahead"
    : horizon === "2y"
      ? "two years ahead"
      : horizon === "3y"
        ? "three years ahead"
        : "five years ahead";

let rows: string[][] | null = null;

for (const candidate of tables) {
  const parsed = parseHtmlTable(candidate);

  const hasWantedRow = parsed.some(
    (row) =>
      normalize(row[0] ?? "") === normalize(wanted)
  );

  if (hasWantedRow) {
  rows = parsed;
  break;
}
}

if (!rows) {
  console.log(
    `[MAPS] No CPI expectation table found for ${url} (${wanted})`
  );
  continue;
}

      const row = rows.find(
        (r) =>
          normalize(r[0] ?? "") ===
          normalize(wanted)
      );

      const value = row
        ? parseNumber(row[2] ?? row[1] ?? "")
        : null;

      if (value != null) {
        points.push({ date, value });
      }
    } catch {
      // Skip unavailable survey page.
    }
  }

  return dedupe(points);
}
async function discoverMapsPages(): Promise<string[]> {
  const urls: string[] = [];
  const currentYear = new Date().getUTCFullYear();

  // MaPS is published only on selected months, so avoid
  // crawling every month from 2016 onward.
  const monthsByYear: Record<number, string[]> = {
    2026: [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "september",
    ],
  };

  const months =
    monthsByYear[currentYear] ?? [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "september",
      "november",
    ];

  for (const month of months) {
    const url =
      `https://www.bankofengland.co.uk/markets/market-intelligence/` +
      `survey-results/${currentYear}/market-participants-survey-results-${month}-${currentYear}`;

    try {
      const html = await fetchText(url);

      if (
  /one year ahead/i.test(html) &&
  /five years ahead/i.test(html)
) {
  console.log(`[MAPS] FOUND: ${url}`);
  urls.push(url);
}
    } catch {
      // Some months do not have a MaPS release.
    }
  }
console.log(`[MAPS] Total pages found: ${urls.length}`);
  return urls;
}
/**
 * The Bank's MPR chart-data ZIP contains the underlying chart 1.9 series for
 * Citi/YouGov and the market inflation-swap measures. We discover the latest
 * ZIP from the report page, then scan spreadsheet/CSV members by semantic
 * column names. This avoids hard-coding a volatile file name.
 */
export async function fetchBoeMprInflationSeries(seriesId: string): Promise<RawPoint[]> {
  if (
    ![
      "CITI_YOUGOV_INFLATION_1Y",
      "CITI_YOUGOV_INFLATION_5_10Y",
      "UK_INFL_COMP_1Y",
      "UK_INFL_COMP_5Y5Y",
    ].includes(seriesId)
  ) {
    throw new Error(`Unknown MPR inflation series ${seriesId}`);
  }

  // Fetch actual official chart data on each refresh. Saved history is merged
  // by the ingestion pipeline; a missing source must never be replaced with a
  // successful, fixed September 2026 snapshot.
  const reportUrls = await findRecentMprPages();
  for (const pageUrl of reportUrls) {
    try {
      const html = await fetchText(pageUrl);
      const zipHref = [...html.matchAll(/href=["']([^"']+\.zip)["']/gi)]
        .map((m) => absolutizeBoEUrl(m[1]!))
        .find((u) => /chart|data|slides/i.test(u));
      if (!zipHref) continue;

      const res = await fetch(zipHref, {
        headers: { "User-Agent": "macro-economy-tracker/1.0" },
      });
      if (!res.ok) continue;

      const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
      console.log("[MPR] testing series:", seriesId);
      const points = scanMprZip(zip, seriesId);
      if (points.length) return points;
    } catch {
      // try the previous report
    }
  }

  throw new Error(`BoE MPR chart-data series ${seriesId} returned no observations`);
}

/** Agents annual expected pay settlement. */
export async function fetchBoeAgentsPaySettlement(): Promise<RawPoint[]> {
  const points: RawPoint[] = [];

  const currentYear =
    new Date().getUTCFullYear();

  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  for (
    let year = 2016;
    year <= currentYear;
    year++
  ) {
    for (const month of months) {
      const url =
        `https://www.bankofengland.co.uk/agents-summary/` +
        `${year}/${month}-${year}`;

      try {
        const page = await fetchText(url);

        const date = parseBoEMonthDate(
          page,
          url
        );

        if (!date) continue;

        const match = page.match(
          /(?:average expected pay settlement|average expected settlement|expected pay settlement|settlements for \d{4} to average)[\s\S]{0,300}?([0-9]+(?:\.[0-9]+)?)%/i
        );

        if (!match) continue;

        const value = Number(match[1]);

        if (Number.isFinite(value)) {
          points.push({
            date,
            value,
          });
        }
      } catch {
        // No Agents release for this month.
      }
    }
  }

  return dedupe(points);
}
async function loadLatestDmpXlsx(): Promise<Buffer> {
  const now = Date.now();
  if (!isFreshReleaseFetch() && cachedXlsx && now - cachedXlsx.at < CACHE_MS) return cachedXlsx.buf;
  const url = await resolveLatestDmpMonthlyXlsxUrl();
  const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "*/*" } });
  if (!res.ok) throw new Error(`BoE DMP xlsx ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  cachedXlsx = { url, buf, at: now };
  return buf;
}

async function resolveLatestDmpMonthlyXlsxUrl(): Promise<string> {
  const pages = [
    currentDmpIndex(),
    "https://www.bankofengland.co.uk/decision-maker-panel",
    "https://decisionmakerpanel.co.uk/data/",
    "https://decisionmakerpanel.co.uk/data/data-archive/",
  ];

  const candidates: Array<{
    url: string;
    year: number;
    month: number;
  }> = [];

  const monthNumber: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  for (const page of pages) {
    try {
      const html = await fetchText(page);

      const matches = [
        ...html.matchAll(
          /href=["']([^"']*monthly-dmp-data-(?:for-website-)?([a-z]+)-(\d{4})(?:-\d+)?\.xlsx)["']/gi
        ),
      ];

      for (const match of matches) {
        const href = match[1];
        const monthName = match[2]?.toLowerCase();
        const year = Number(match[3]);
        const month = monthNumber[monthName ?? ""];

        if (!href || !month || !Number.isFinite(year)) continue;

        candidates.push({
          url: absolutizeBoEUrl(href),
          year,
          month,
        });
      }
    } catch {
      // Try the next page.
    }
  }

  const unique = Array.from(
    new Map(candidates.map((item) => [item.url, item])).values()
  );

  unique.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  if (unique.length > 0) {
    console.log(
      `[DMP] Latest monthly workbook: ${unique[0]!.year}-${String(
        unique[0]!.month
      ).padStart(2, "0")} ${unique[0]!.url}`
    );

    return unique[0]!.url;
  }

  throw new Error("BoE DMP monthly xlsx URL not found");
}

async function fetchDmpMonthlyHistoryByHeader(seriesId: string): Promise<RawPoint[]> {
  // Read the official aggregate workbook. The prose release rounds values and
  // reports three-month averages, while these CPI metric IDs use the labeled
  // single-month series from the workbook.
  if (seriesId === "DMP_CPI_EXPECTED_1Y" || seriesId === "DMP_CPI_EXPECTED_3Y") {
    return fetchDmpCpiExpectationHistory(seriesId);
  }

  if (seriesId === "DMP_OWN_PRICE_EXPECTED_1Y") {
    return fetchDmpOwnPriceExpectationHistory();
  }

  throw new Error(`Unsupported DMP series ${seriesId}`);
}

async function fetchDmpCpiExpectationHistory(
  seriesId: "DMP_CPI_EXPECTED_1Y" | "DMP_CPI_EXPECTED_3Y"
): Promise<RawPoint[]> {
  // The DMP workbook has single-month and three-month columns side by side.
  // These IDs represent the monthly single-month series, so resolve their
  // columns from the labels instead of assuming a fixed offset.
  const workbook = XLSX.read(await loadLatestDmpXlsx(), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalize(name) === "cpi expectations");
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("DMP workbook is missing the CPI expectations sheet");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const group = seriesId === "DMP_CPI_EXPECTED_1Y" ? /1\s*year.*ahead/ : /3\s*year.*ahead/;
  return parseDmpGroupedSheet(rows, group, /single month/, `CPI expectations (${seriesId})`);
}

async function fetchDmpOwnPriceExpectationHistory(): Promise<RawPoint[]> {
  // Release prose rounds this three-month measure to one decimal. Use the
  // official aggregate workbook so historical values retain source precision.
  const workbook = XLSX.read(await loadLatestDmpXlsx(), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalize(name) === "price growth");
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("DMP workbook is missing the Price growth sheet");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  return parseDmpGroupedSheet(rows, /expected price growth/, /3\s*month average/, "own-price expectations");
}
async function fetchDmpOwnPriceHistoryFromPages(): Promise<RawPoint[]> {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  const years = [2026, 2025, 2024, 2023, 2022];

  const points: RawPoint[] = [];

  for (const year of years) {
    for (const month of months) {
      // September 2026 has not been published yet as of 23 September 2026.
      if (year === 2026 && month === "september") {
        continue;
      }

      const url =
        `https://www.bankofengland.co.uk/decision-maker-panel/` +
        `${year}/${month}-${year}`;

      try {
        const html = await fetchText(url);

        const date = parseBoEMonthDate(html, url);
        if (!date) continue;

        const text = normalize(
          stripHtml(html)
        );

        let value: number | null = null;

        const patterns = [
          /year-ahead own-price inflation was expected to be\s+([0-9]+(?:\.[0-9]+)?)%/i,

          /year-ahead output price inflation was expected to be\s+([0-9]+(?:\.[0-9]+)?)%/i,

          /year ahead,\s+businesses expected their output price inflation to be\s+([0-9]+(?:\.[0-9]+)?)%/i,
        ];

        for (const pattern of patterns) {
          const match = text.match(pattern);

          if (match) {
            value = Number(match[1]);
            break;
          }
        }

        if (
          date &&
          value != null &&
          Number.isFinite(value) &&
          value >= -5 &&
          value <= 15
        ) {
          points.push({
            date,
            value,
          });
        }
      } catch {
        // Some monthly pages may not exist; skip them.
      }
    }
  }

  return dedupe(points).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}
function extractMarketInflationCompensationFromChart19(
  rows: string[][],
  seriesId: "UK_INFL_COMP_1Y" | "UK_INFL_COMP_5Y5Y"
): RawPoint[] {
  /*
   * Chart 1.9:
   *
   * Market-based inflation compensation:
   *   column 0 = date
   *   column 5 = short-term / 1Y inflation compensation
   *   column 6 = medium-term / 5Y5Y inflation compensation
   *
   * Citi/YouGov is a separate block later in the same chart:
   *   column 0 = date
   *   column 9 = short-term expectations
   *   column 10 = medium-term expectations
   *
   * Therefore market extraction must explicitly require:
   *   - a valid date in column 0
   *   - a valid market value in column 5 or 6
   */

  const target =
    "market-based measures of inflation compensation and survey-based measures of business and household inflation expectations";

  const chartIndexes: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowText = rows[i]?.join(" ").toLowerCase() ?? "";

    if (rowText.includes(target)) {
      chartIndexes.push(i);
    }
  }

  console.log(
    `[MARKET] ${seriesId}: found ${chartIndexes.length} matching Chart 1.9 blocks`
  );

  const valueIndex =
    seriesId === "UK_INFL_COMP_1Y" ? 5 : 6;

  const candidates: RawPoint[] = [];

  for (const chartIndex of chartIndexes) {
    const out: RawPoint[] = [];

    for (let i = chartIndex + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const firstCell = (row[0] ?? "").trim();

      if (
        firstCell === "__SHEET_START__" ||
        firstCell === "__SHEET_END__" ||
        /^chart\s+\d+\.\d+/i.test(firstCell)
      ) {
        break;
      }

      // Market data uses column 0 for the date.
      const date = normalizeDate(row[0] ?? "");
      if (!date) continue;

      // Market data uses column 5 or 6.
      const value = parseNumber(row[valueIndex] ?? "");

      if (
        value != null &&
        Number.isFinite(value) &&
        value >= -5 &&
        value <= 15
      ) {
        out.push({ date, value });
      }
    }

    const deduped = dedupe(out);

    console.log(
      `[MARKET] ${seriesId}: block ${chartIndex} produced ${deduped.length} observations`,
      deduped.length
        ? `${deduped[0]?.date} -> ${deduped[deduped.length - 1]?.date}`
        : ""
    );

    candidates.push(...deduped);
  }

  return dedupe(
    candidates.sort((a, b) => a.date.localeCompare(b.date))
  );
}

function extractDmpOwnPriceExpectationRows(
  rows: string[][]
): RawPoint[] {
  const normalizedRows = rows.map((row) =>
    row.map((cell) => normalize(cell))
  );

  // Find the section describing own-price expectations.
  const sectionIndex = normalizedRows.findIndex((row) =>
    row.some((cell) =>
      cell.includes("own price") &&
      (
        cell.includes("expect") ||
        cell.includes("inflation")
      )
    )
  );

  if (sectionIndex < 0) {
    return [];
  }

  const out: RawPoint[] = [];

  // Look for a header containing "year ahead".
  for (
    let headerIndex = sectionIndex;
    headerIndex < Math.min(
      rows.length,
      sectionIndex + 20
    );
    headerIndex++
  ) {
    const header = normalizedRows[headerIndex] ?? [];

    const valueIndex = header.findIndex((cell) =>
      cell.includes("year ahead")
    );

    if (valueIndex < 0) continue;

    for (
      let r = headerIndex + 1;
      r < rows.length;
      r++
    ) {
      const row = rows[r] ?? [];

      const date = normalizeDate(row[0] ?? "");
      const value = parseNumber(
        row[valueIndex] ?? ""
      );

      if (
        date &&
        value != null &&
        Number.isFinite(value) &&
        value >= -5 &&
        value <= 15
      ) {
        out.push({
          date,
          value,
        });
      }
    }

    if (out.length) {
      return dedupe(out);
    }
  }

  return [];
}
async function discoverDmpXlsxUrls(): Promise<string[]> {
  const urls = new Set<string>();

  const years = [
    new Date().getUTCFullYear(),
    new Date().getUTCFullYear() - 1,
    new Date().getUTCFullYear() - 2,
  ];

  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  for (const year of years) {
    for (const month of months) {
      const page =
        `https://www.bankofengland.co.uk/decision-maker-panel/` +
        `${year}/${month}-${year}`;

      try {
        const html = await fetchText(page);

        for (const match of html.matchAll(
          /href=["']([^"']+\.xlsx)["']/gi
        )) {
          const href = match[1];
          if (!href) continue;

          const url = absolutizeBoEUrl(href);

          if (/decision-maker-panel|dmp|monthly/i.test(url)) {
            urls.add(url);
          }
        }
      } catch {
        // No DMP release for this month.
      }
    }
  }

  return [...urls];
}

function seriesAliases(seriesId: string): string[] {
  if (seriesId === "DMP_CPI_EXPECTED_1Y") {
    return [
      "cpi inflation",
      "year ahead cpi",
      "year ahead inflation",
      "expected cpi",
      "cpi expected",
    ];
  }

  if (seriesId === "DMP_CPI_EXPECTED_3Y") {
    return [
      "three year ahead cpi",
      "three years ahead cpi",
      "three year cpi",
      "three years cpi",
      "cpi inflation three years",
      "expected cpi three years",
    ];
  }

  return [
    "own price inflation",
    "own price",
    "year ahead own price",
    "expected own price",
    "own price expected",
  ];
}
function extractCitiYouGovFromChart19(
  rows: string[][],
  horizon: "1Y" | "5-10Y"
): RawPoint[] {
  const points: RawPoint[] = [];
  // Each chart panel has its own date column. Locate the named household
  // panel and its header row; never borrow dates from market/DMP columns.
  for (let i = 0; i < rows.length; i++) {
    const group = rows[i] ?? [];
    const householdColumn = group.findIndex(cell => /citi/.test(normalize(cell)) && /yougov/.test(normalize(cell)));
    if (householdColumn < 0) continue;
    const nextGroup = group.findIndex((cell, col) => col > householdColumn && cell.trim() !== "");
    const groupEnd = nextGroup < 0 ? Infinity : nextGroup;
    for (let h = i + 1; h <= Math.min(i + 4, rows.length - 1); h++) {
      const headers = rows[h] ?? [];
      const valueColumn = headers.findIndex((cell, col) => {
        if (col < householdColumn || col >= groupEnd || /average/.test(normalize(cell))) return false;
        return horizon === "1Y"
          ? /short term|one year|1 year|12 month/.test(normalize(cell))
          : /medium term|long.*term|five.*ten|5.*10/.test(normalize(cell));
      });
      if (valueColumn < 0) continue;
      let dateColumn = -1;
      for (let col = valueColumn - 1; col >= 0; col--) {
        if (normalize(headers[col] ?? "") === "date") { dateColumn = col; break; }
      }
      if (dateColumn < 0) continue;
      for (let r = h + 1; r < rows.length; r++) {
        const row = rows[r] ?? [];
        if (/^chart\s+[a-z0-9]+\.\d+/i.test(row[0] ?? "") || /^__SHEET_(?:START|END)__$/.test(row[0] ?? "")) break;
        const date = normalizeDate(row[dateColumn] ?? "");
        const value = parseNumber(row[valueColumn] ?? "");
        if (date && value != null && value >= -5 && value <= 15) {
          points.push({ date: `${date.slice(0, 7)}-01`, value });
        }
      }
      break;
    }
  }
  return dedupe(points);
}
function scanMprZip(zip: AdmZip, seriesId: string): RawPoint[] {
  const entries = zip.getEntries();
console.log(
  `[MPR DEBUG] ${seriesId}: ZIP entries`,
  entries.map((e) => e.entryName)
);
  const aliases = seriesId.startsWith("CITI_")
    ? seriesId.endsWith("1Y")
      ? ["citi", "yougov", "one year"]
      : ["citi", "yougov", "5-10"]
    : seriesId === "UK_INFL_COMP_1Y"
      ? ["one-year inflation swap", "1 year inflation swap", "inflation compensation"]
      : ["five-year, five-year forward", "5y5y", "forward inflation swap"];

  const out: RawPoint[] = [];

  for (const entry of entries) {
    const name = entry.entryName.toLowerCase();

    if (!/\.(csv|txt|xlsx|xlsm)$/i.test(name)) continue;

    try {
      const buf = entry.getData();

      if (/\.(csv|txt)$/i.test(name)) {
        // Chart 1.9 inflation series are parsed only from the dedicated
        // workbook block below. Do not let a CSV with a loosely matching
        // header reintroduce unrelated date/value pairs.
        if (
          seriesId !== "CITI_YOUGOV_INFLATION_1Y" &&
          seriesId !== "CITI_YOUGOV_INFLATION_5_10Y" &&
          seriesId !== "UK_INFL_COMP_1Y" &&
          seriesId !== "UK_INFL_COMP_5Y5Y"
        ) {
          out.push(
            ...extractPointsFromCsv(buf.toString("utf8"), aliases)
          );
        }
      } else {
        // Use the workbook reader for Citi/YouGov. The legacy XML scanner
        // consumes self-closing blank cells as if they opened a value cell,
        // shifting the household headers and dates into adjacent columns.
        const isCiti = seriesId === "CITI_YOUGOV_INFLATION_1Y" || seriesId === "CITI_YOUGOV_INFLATION_5_10Y";
        const workbook = isCiti ? XLSX.read(buf, { type: "buffer", cellDates: false }) : null;
        const rows = workbook ? workbook.SheetNames.flatMap(name => [
          ["__SHEET_START__", name],
          ...XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, defval: "", raw: true })
            .map(row => row.map(cell => String(cell ?? ""))),
          ["__SHEET_END__", name],
        ]) : scanXlsx(buf);
        const chartTitles = rows
  .map((row) => (row[0] ?? "").trim())
  .filter((cell) => /^chart\s+\d+\.\d+/i.test(cell));

        if (
          seriesId === "CITI_YOUGOV_INFLATION_1Y" ||
          seriesId === "CITI_YOUGOV_INFLATION_5_10Y"
        ) {
          // Both Citi/YouGov series live in the dedicated Chart 1.9 survey
          // block. Never send either series through the generic semantic
          // parser because it can match the wrong date/value block.
          out.push(
            ...extractCitiYouGovFromChart19(
              rows,
              seriesId === "CITI_YOUGOV_INFLATION_1Y"
                ? "1Y"
                : "5-10Y"
            )
          );
        } else if (
          seriesId === "UK_INFL_COMP_1Y" ||
          seriesId === "UK_INFL_COMP_5Y5Y"
        ) {
          out.push(
            ...extractMarketInflationCompensationFromChart19(
              rows,
              seriesId
            )
          );
        } else {
          out.push(
            ...extractPointsFromRows(rows, aliases)
          );
        }
      }
    } catch {}
  }

  return dedupe(out);
}

function extractPointsFromCsv(text: string, aliases: string[]): RawPoint[] {
  const rows = text.split(/\r?\n/).map((x) => x.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  return extractPointsFromRows(rows, aliases);
}

function scanXlsx(buf: Buffer): string[][] {
    const zip = new AdmZip(buf);
    const shared = parseSharedStrings(
      zip.getEntry("xl/sharedStrings.xml")?.getData().toString("utf8") ?? ""
    );
    console.log("[DMP SHARED STRINGS]", {
  314: shared[314],
  315: shared[315],
  104: shared[104],
  64: shared[64],
  65: shared[65],
  106: shared[106],
  107: shared[107],
});

    const entries = zip
      .getEntries()
      .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    const rows: string[][] = [];

    for (const entry of entries) {
      rows.push(["__SHEET_START__", entry.entryName]);
      rows.push(...parseSheetRows(entry.getData().toString("utf8"), shared));
      rows.push(["__SHEET_END__", entry.entryName]);
    }

    return rows;
}

function extractPointsFromRows(rows: string[][], aliases: string[]): RawPoint[] {
  const normalized = aliases.map(normalize);
  for (let i = 0; i < rows.length; i++) {
    const header = rows[i] ?? [];
    const valueIndex = header.findIndex((cell) => normalized.some((a) => normalize(cell).includes(a)));
    if (valueIndex < 0) continue;
    const dateIndex = header.findIndex((cell) => /date|month|period|year/i.test(cell));
    if (dateIndex < 0) continue;

    const out: RawPoint[] = [];
    for (let r = i + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const date = normalizeDate(row[dateIndex] ?? "");
      const value = parseNumber(row[valueIndex] ?? "");
      if (date && value != null) out.push({ date, value });
    }
    if (out.length) return out;
  }
  return [];
}

function parseSheetRows(xml: string, shared: string[]): string[][] {
  const out: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells: Record<number, string> = {};
    const cellRe = /<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1] ?? ""))) {
      const col = excelCol(cellMatch[1] ?? "A");
      const attrs = cellMatch[2] ?? "";
      const inner = cellMatch[3] ?? "";
      const v =
  inner.match(/<v>([^<]*)<\/v>/i)?.[1] ?? "";

const inlineText = [
  ...inner.matchAll(
    /<t[^>]*>([\s\S]*?)<\/t>/gi
  ),
]
  .map((m) => m[1] ?? "")
  .join("");

const t =
  attrs.match(/t="([^"]+)"/i)?.[1];

if (t === "s") {
  cells[col] =
    shared[Number(v)] ?? "";
} else if (t === "inlineStr") {
  cells[col] = inlineText;
} else {
  cells[col] = v || inlineText;
}
    }
    const max = Math.max(-1, ...Object.keys(cells).map(Number));
    out.push(Array.from({ length: max + 1 }, (_, i) => cells[i] ?? ""));
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/gi)) {
    out.push([...m[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/gi)].map((x) => x[1] ?? "").join(""));
  }
  return out;
}

function excelCol(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function parseDmpWageSheet(xlsx: Buffer, seriesId: DmpWageSeries): RawPoint[] {
  const workbook = XLSX.read(xlsx, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalize(name) === "wage growth");
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("DMP workbook is missing the Wage growth sheet");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const realised = seriesId === "DMP_WAGE_REALISED_3M" || seriesId === "DMP_WAGE_REALISED_1M";
  const average = seriesId === "DMP_WAGE_REALISED_3M" || seriesId === "DMP_WAGE_EXPECTED_3M";
  return parseDmpGroupedSheet(
    rows,
    realised ? /realised wage growth/ : /expected wage growth/,
    average ? /3\s*month average/ : /single month/,
    seriesId,
  );
}

/** Resolve a data column by both its measure group and statistic label. */
function parseDmpGroupedSheet(
  rows: unknown[][],
  groupPattern: RegExp,
  statisticPattern: RegExp,
  seriesLabel: string,
): RawPoint[] {
  for (let headerRowIndex = 1; headerRowIndex < rows.length; headerRowIndex++) {
    const headerRow = rows[headerRowIndex] ?? [];
    const dateColumn = headerRow.findIndex((value) => /survey date/.test(normalize(String(value ?? ""))));
    if (dateColumn < 0) continue;

    const groupRow = rows[headerRowIndex - 1] ?? [];
    const groupColumn = groupRow.findIndex((value) => groupPattern.test(normalize(String(value ?? ""))));
    if (groupColumn < 0) continue;
    const nextGroupColumn = groupRow.findIndex((value, index) =>
      index > groupColumn && String(value ?? "").trim() !== "",
    );
    const groupEnd = nextGroupColumn < 0 ? headerRow.length : nextGroupColumn;
    const valueColumn = headerRow.findIndex((value, index) =>
      index >= groupColumn && index < groupEnd && statisticPattern.test(normalize(String(value ?? ""))),
    );
    if (valueColumn < 0) continue;

    const points = new Map<string, number>();
    for (const row of rows.slice(headerRowIndex + 1)) {
      const rawDate = row[dateColumn];
      const date = rawDate instanceof Date
        ? `${rawDate.getUTCFullYear()}-${String(rawDate.getUTCMonth() + 1).padStart(2, "0")}-01`
        : normalizeDate(String(rawDate ?? ""));
      const rawValue = row[valueColumn];
      const value = typeof rawValue === "number" ? rawValue : parseNumber(String(rawValue ?? ""));
      if (date && value != null && Number.isFinite(value) && value >= -10 && value <= 20) {
        points.set(date, value);
      }
    }
    const result = [...points.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
    if (!result.length) throw new Error(`DMP workbook has no values for ${seriesLabel}`);
    return result;
  }
  throw new Error(`DMP workbook is missing the labeled ${seriesLabel} column`);
}

function extractTableContaining(html: string, ...needles: string[]): string | null {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  return tables.find((table) => needles.every((n) => normalize(stripHtml(table)).includes(normalize(n)))) ?? null;
}

function parseHtmlTable(table: string): string[][] {
  return (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
    (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(stripHtml)
  );
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function parseBoEMonthDate(html: string, url: string): string | null {
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const candidates = `${title} ${url}`;
  const m = candidates.match(/(January|February|March|April|May|June|July|August|September|October|November|December)[ -](\d{4})/i);
  if (m) return `${m[2]}-${monthNum(m[1]!)}-01`;
  const y = url.match(/\/(20\d{2})\//)?.[1];
  return y ? `${y}-01-01` : null;
}

function monthNum(name: string): string {
  const map: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };

  return map[name.trim().toLowerCase()] ?? "01";
}

function normalizeDate(value: string): string | null {
  const s = value.trim();
    // Excel serial date (e.g. 44773)
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s);

    if (Number.isFinite(serial)) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const date = new Date(excelEpoch + serial * 86400000);

      return date.toISOString().slice(0, 10);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  const m = s.match(/^(\d{4})[./-]Q([1-4])$/i);
  if (m) return `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, "0")}-01`;
  const mon = s.match(/^([A-Za-z]+)[ -](\d{4})$/);
  if (mon) return `${mon[2]}-${monthNum(mon[1]!)}-01`;
  const short = s.match(/^([A-Za-z]{3})-(\d{2})$/);

if (short) {
  const year = Number(short[2]);
  const month = monthNum(short[1]!);

  if (month) {
    return `${year >= 16 ? 2000 + year : 2100 + year}-${month}-01`;
  }
}
  return null;
}

function dmpDateToIso(label: string): string | null { return normalizeDate(label); }
function parseNumber(value: string): number | null {
  const cleaned = value.replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned) || /^-$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function normalize(value: string): string { return value.toLowerCase().replace(/[–—-]/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function dedupe(points: RawPoint[]): RawPoint[] {
  const map = new Map<string, number>();
  for (const p of points) map.set(p.date, p.value);
  return [...map.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([date,value]) => ({date,value}));
}
function absolutizeBoEUrl(href: string): string { return new URL(href, "https://www.bankofengland.co.uk").toString(); }
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`BoE request ${res.status}: ${url}`);
  return res.text();
}
async function findRecentMprPages(): Promise<string[]> {
  const html = await fetchText(MPR_INDEX);
  const candidates = new Map<string, number>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = new URL(match[1]!.replace(/&amp;/g, "&"), MPR_INDEX);
    const period = url.pathname.match(/^\/monetary-policy-report\/(20\d{2})\/([a-z]+)-(20\d{2})$/i);
    if (url.origin !== "https://www.bankofengland.co.uk" || !period || period[1] !== period[3]) continue;
    const month = monthNum(period[2]!);
    if (!/^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(period[2]!)) continue;
    candidates.set(url.toString(), Number(period[1]) * 12 + Number(month));
  }
  // Upcoming report placeholders have no data ZIP, so the caller tries the
  // next published report. All report URLs come from the official index.
  return [...candidates].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([url]) => url);
}
