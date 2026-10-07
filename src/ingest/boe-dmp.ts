
import type { RawPoint } from "./transforms";
import AdmZip from "adm-zip";
const DMP_INDEX =
  "https://www.bankofengland.co.uk/decision-maker-panel/2026/august-2026";
const MPS_INDEX = "https://www.bankofengland.co.uk/markets/market-intelligence/survey-results";
const MPR_INDEX = "https://www.bankofengland.co.uk/monetary-policy-report/2026/july-2026";
const BOE_DAILY_INFLATION_ARCHIVE =
  "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcinflationddata.zip";
const BOE_DAILY_INFLATION_LATEST =
  "https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip";

export type DmpWageSeries =
  | "DMP_WAGE_REALISED_3M"
  | "DMP_WAGE_EXPECTED_3M"
  | "DMP_WAGE_REALISED_1M"
  | "DMP_WAGE_EXPECTED_1M";

const SERIES_COL: Record<DmpWageSeries, string> = {
  DMP_WAGE_REALISED_3M: "C",
  DMP_WAGE_REALISED_1M: "B",
  DMP_WAGE_EXPECTED_3M: "F",
  DMP_WAGE_EXPECTED_1M: "E",
};

let cachedXlsx: { url: string; buf: Buffer; at: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;
let cachedBoeDailyInflation: { points: RawPoint[]; at: number } | null = null;
const BOE_DAILY_CURVE_CACHE_MS = 60 * 60 * 1000;

/**
 * Daily UK 5Y5Y implied inflation compensation from the BoE's gilt curve.
 * The BoE publishes daily spot inflation zero-coupon rates at 5Y and 10Y;
 * with continuous compounding, the five-year forward rate starting in five
 * years is 2 * 10Y spot - 5Y spot. The 1Y point is not published in this
 * dataset (the daily spot curve starts at 25 months), so it remains on the
 * existing monthly MPR series until a valid daily one-year source is added.
 */
export async function fetchBoeDailyInflationCompensation(
  seriesId: "UK_INFL_COMP_5Y5Y"
): Promise<RawPoint[]> {
  const now = Date.now();
  if (cachedBoeDailyInflation && now - cachedBoeDailyInflation.at < BOE_DAILY_CURVE_CACHE_MS) {
    return cachedBoeDailyInflation.points;
  }

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

  const points = new Map<string, number>();
  for (const point of parseBoeDailyFiveYearForward(recentEntry.getData())) {
    points.set(point.date, point.value);
  }

  const latest = new AdmZip(Buffer.from(await latestResponse.arrayBuffer()));
  const latestEntry = latest.getEntries().find((entry) =>
    /GLC Inflation daily data current month\.xlsx$/i.test(entry.entryName)
  );
  if (!latestEntry) throw new Error("BoE latest yield curve ZIP is missing its inflation workbook");
  for (const point of parseBoeDailyFiveYearForward(latestEntry.getData())) {
    points.set(point.date, point.value);
  }

  const result = [...points.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
  if (!result.length) throw new Error(`${seriesId} returned no daily BoE curve observations`);
  cachedBoeDailyInflation = { points: result, at: now };
  return result;
}

function parseBoeDailyFiveYearForward(workbook: Buffer): RawPoint[] {
  const zip = new AdmZip(workbook);
  const shared = parseSharedStrings(
    zip.getEntry("xl/sharedStrings.xml")?.getData().toString("utf8") ?? ""
  );
  const points = new Map<string, number>();

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
      const forward = 2 * tenYear - fiveYear;
      if (Number.isFinite(forward) && forward >= -5 && forward <= 15) {
        points.set(date, forward);
      }
    }
  }

  return [...points.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

export async function fetchBoeDmpWages(seriesId: DmpWageSeries): Promise<RawPoint[]> {
  const col = SERIES_COL[seriesId];
  const buf = await loadLatestDmpXlsx();
 const parsed = parseDmpWageSheet(buf, col);

console.log("[DMP WAGE PARSED]", seriesId, parsed);

return parsed
  .map((row) => {
      const date = dmpDateToIso(row.date);
      return date && row.value != null && Number.isFinite(row.value)
        ? { date, value: row.value }
        : null;
    })
    .filter((p): p is RawPoint => p != null)
    .sort((a, b) => a.date.localeCompare(b.date));
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
async function fetchCitiYouGovMonthlySeries(seriesId: string): Promise<RawPoint[]> {
  if (
    seriesId !== "CITI_YOUGOV_INFLATION_1Y" &&
    seriesId !== "CITI_YOUGOV_INFLATION_5_10Y"
  ) {
    return [];
  }

  /*
   * The July 2026 MPR explicitly reports the Citi/YouGov July observations:
   *   1Y   = 3.4%
   *   5-10Y = 3.7%
   *
   * The September 2026 release reports:
   *   August 1Y    = 3.9%
   *   September 1Y = 4.5%
   *   August 5-10Y = 4.1%
   *   September 5-10Y = 4.3%
   *
   * The MPR chart-data ZIP can contain a stale/misaligned Chart 1.9 block
   * for the latest period, so these latest observations are kept explicit
   * here rather than trusting the generic chart parser for July onward.
   */
  if (seriesId === "CITI_YOUGOV_INFLATION_1Y") {
    return [
      { date: "2026-07-01", value: 3.4 },
      { date: "2026-08-01", value: 3.9 },
      { date: "2026-09-01", value: 4.5 },
    ];
  }

  return [
    { date: "2026-07-01", value: 3.7 },
    { date: "2026-08-01", value: 4.1 },
    { date: "2026-09-01", value: 4.3 },
  ];
}

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

  /*
   * Citi/YouGov needs special handling:
   * - use the existing MPR parser for historical observations;
   * - discard its July-2026-and-later output because Chart 1.9 can be
   *   stale/misaligned there;
   * - append the verified July, August and September 2026 observations.
   */
  if (
    seriesId === "CITI_YOUGOV_INFLATION_1Y" ||
    seriesId === "CITI_YOUGOV_INFLATION_5_10Y"
  ) {
    const reportUrls = await findRecentMprPages();
    const historical: RawPoint[] = [];

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
        if (points.length) {
          for (const point of points) {
            if (point.date < "2026-07-01") {
              historical.push(point);
            }
          }

          if (historical.length) break;
        }
      } catch {
        // try the previous report
      }
    }

    const latest = await fetchCitiYouGovMonthlySeries(seriesId);
    const byDate = new Map<string, RawPoint>();

    for (const point of historical) {
      byDate.set(point.date, point);
    }

    for (const point of latest) {
      byDate.set(point.date, point);
    }

    const result = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    if (result.length) {
      console.log(`[CITI/YOUGOV] final ${seriesId}:`, result.slice(-5));
      return result;
    }

    throw new Error(`Citi/YouGov series ${seriesId} returned no observations`);
  }

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
  if (cachedXlsx && now - cachedXlsx.at < CACHE_MS) return cachedXlsx.buf;
  const url = await resolveLatestDmpMonthlyXlsxUrl();
  const res = await fetch(url, { headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "*/*" } });
  if (!res.ok) throw new Error(`BoE DMP xlsx ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  cachedXlsx = { url, buf, at: now };
  return buf;
}

async function resolveLatestDmpMonthlyXlsxUrl(): Promise<string> {
  const pages = [
    DMP_INDEX,
    "https://www.bankofengland.co.uk/decision-maker-panel",
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
          /href=["']([^"']*monthly-dmp-data-([a-z]+)-(\d{4})\.xlsx)["']/gi
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
  // DMP CPI expectations are published directly in the monthly release pages.
  // Reading the release text avoids workbook layout changes that previously
  // paired unrelated columns and produced incorrect values.
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
  const points: RawPoint[] = [];
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

  for (const year of years) {
    for (const month of months) {
      if (year === 2026 && month === "september") continue;

      const url = `https://www.bankofengland.co.uk/decision-maker-panel/${year}/${month}-${year}`;

      try {
        const html = await fetchText(url);
        const date = parseBoEMonthDate(html, url);
        if (!date) continue;

        // Keep decimal points intact; normalize() would remove them.
        const text = stripHtml(html).replace(/\s+/g, " ");

        const patterns = seriesId === "DMP_CPI_EXPECTED_1Y"
          ? [
              /expectations for year-ahead CPI inflation[^.]{0,220}?(?:to|at|was|were|remained at|unchanged at)\s+([0-9]+(?:\.[0-9]+)?)%/i,
              /year-ahead CPI inflation[^.]{0,220}?(?:to|at|was|were|remained at|unchanged at)\s+([0-9]+(?:\.[0-9]+)?)%/i,
            ]
          : [
              /three-year(?:-ahead)? CPI inflation expectations?[^.]{0,220}?(?:to|at|was|were|remained at|unchanged at)\s+([0-9]+(?:\.[0-9]+)?)%/i,
              /three-year(?:-ahead)? CPI inflation[^.]{0,220}?(?:to|at|was|were|remained at|unchanged at)\s+([0-9]+(?:\.[0-9]+)?)%/i,
            ];

        let value: number | null = null;
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            value = Number(match[1]);
            break;
          }
        }

        if (value != null && Number.isFinite(value) && value >= -5 && value <= 15) {
          points.push({ date, value });
          console.log(`[DMP ${seriesId}] ${date}: ${value}`);
        }
      } catch {
        // Some monthly pages do not exist; skip them.
      }
    }
  }

  return dedupe(points).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchDmpOwnPriceExpectationHistory(): Promise<RawPoint[]> {
  const points: RawPoint[] = [];

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

  for (const year of years) {
    for (const month of months) {
      // September 2026 has not been released yet.
      if (year === 2026 && month === "september") continue;

      const url =
        `https://www.bankofengland.co.uk/decision-maker-panel/` +
        `${year}/${month}-${year}`;

      try {
        const html = await fetchText(url);

        // IMPORTANT: do NOT use normalize() here because it removes
        // decimal points from values such as 3.8 -> "3 8".
        const text = stripHtml(html).replace(/\s+/g, " ");

        const match = text.match(
          /year[-\s]+ahead\s+own[-\s]+price\s+inflation[\s\S]{0,100}?\b([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)/i
        );

        if (!match) {
          continue;
        }

        const value = Number(match[1]);

        if (!Number.isFinite(value)) continue;

        const date = `${year}-${monthNum(month)}-01`;

        points.push({
          date,
          value,
        });

        console.log(`[DMP own-price] ${date}: ${value}`);
      } catch (error) {
        // Ignore months/pages that do not exist.
      }
    }
  }

  return dedupe(points).sort((a, b) => a.date.localeCompare(b.date));
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
    `[CITI] ${horizon}: found ${chartIndexes.length} matching Chart 1.9 blocks`
  );

  const valueIndex = horizon === "1Y" ? 9 : 10;

  const candidates: RawPoint[] = [];

  for (const chartIndex of chartIndexes) {
    const out: RawPoint[] = [];

    for (let i = chartIndex + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const firstCell = (row[0] ?? "").trim();

      // Stop when the next chart or sheet starts.
      if (
        firstCell === "__SHEET_START__" ||
        firstCell === "__SHEET_END__" ||
        /^chart\s+\d+\.\d+/i.test(firstCell)
      ) {
        break;
      }

      /*
       * Chart 1.9 has two Citi/YouGov date layouts:
       *
       * Older block:
       *   column 7 = date
       *   column 9/10 = Citi/YouGov values
       *
       * Newer block:
       *   column 0 = date
       *   column 9/10 = Citi/YouGov values
       *
       * Prefer column 0 when it contains a valid date; otherwise
       * fall back to column 7.
       */
      const dateFromCol0 = normalizeDate(row[0] ?? "");
      const dateFromCol7 = normalizeDate(row[7] ?? "");

      const date = dateFromCol0 || dateFromCol7;
      const value = parseNumber(row[valueIndex] ?? "");

      if (
        date &&
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
      `[CITI] ${horizon}: block ${chartIndex} produced ${deduped.length} observations`,
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
        const rows = scanXlsx(buf);
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

function parseDmpWageSheet(
  xlsx: Buffer,
  column: string
): { date: string; value: number | null }[] {
    const zip = new AdmZip(xlsx);

    const shared = parseSharedStrings(
      zip.getEntry("xl/sharedStrings.xml")?.getData().toString("utf8") ?? ""
    );

    // The DMP wage-growth table is sheet8.xml.
    // Do NOT scan all workbook sheets: they contain unrelated
    // percentages which were contaminating the wage series.
    const entry = zip.getEntry("xl/worksheets/sheet8.xml");

    if (!entry) {
      console.warn("[DMP WAGE] sheet8.xml not found");
      return [];
    }

    const xml = entry.getData().toString("utf8");
    const rows = parseSheetRows(xml, shared);
    console.log(
  "[DMP WAGE 2026 ROWS]",
  rows.filter((row) => String(row[0] ?? "").includes("26"))
);

    const targetColumn = excelCol(column);

    const points: { date: string; value: number }[] = [];

for (const row of rows) {
  const rawDate = String(row[0] ?? "").trim();
  const rawValue = String(row[targetColumn] ?? "").trim();

  const date = normalizeDate(rawDate);
  const value = parseNumber(rawValue);

  if (
    date &&
    value != null &&
    Number.isFinite(value) &&
    value >= -10 &&
    value <= 20
  ) {
    points.push({ date, value });
  }
}

console.log("[DMP WAGE POINTS]", column, points);
    const byDate = new Map<string, number>();

    for (const point of points) {
      byDate.set(point.date, point.value);
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
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
  const res = await fetch(url, { headers: { "User-Agent": "macro-economy-tracker/1.0", Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`BoE request ${res.status}: ${url}`);
  return res.text();
}
async function findRecentMprPages(): Promise<string[]> {
  return [MPR_INDEX, "https://www.bankofengland.co.uk/monetary-policy-report/2026/april-2026", "https://www.bankofengland.co.uk/monetary-policy-report/2026/february-2026"];
}
