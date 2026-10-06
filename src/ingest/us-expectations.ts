import type { RawPoint } from "./transforms";
import * as cheerio from "cheerio";
const ATLANTA_BIE_URL =
  "https://www.atlantafed.org/research-and-data/surveys/business-inflation-expectations";

export async function fetchAtlantaBieSeries(
  series: "price" | "unit-cost" = "unit-cost"
): Promise<RawPoint[]> {
  const response = await fetch(ATLANTA_BIE_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*",
      "User-Agent": "MacroHub/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Atlanta Fed BIE request failed: HTTP ${response.status}`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const currentYear = new Date().getFullYear();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const pdfLinks: string[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().replace(/\s+/g, " ").trim();

    const isCurrentYearChartPack =
      text.includes(String(currentYear)) &&
      monthNames.some((month) => text.includes(month)) &&
      /\.pdf(?:$|[?#])/i.test(href);

    if (!isCurrentYearChartPack) {
      return;
    }

    const absoluteUrl = new URL(
      href,
      ATLANTA_BIE_URL
    ).toString();

    if (!pdfLinks.includes(absoluteUrl)) {
      pdfLinks.push(absoluteUrl);
    }
  });

  const points: RawPoint[] = [];

  for (const pdfUrl of pdfLinks) {
    try {
      const pdfResponse = await fetch(pdfUrl, {
        headers: {
          Accept: "application/pdf,*/*",
          "User-Agent": "MacroHub/1.0",
        },
        cache: "no-store",
      });

      if (!pdfResponse.ok) {
        continue;
      }

      const buffer = Buffer.from(
        await pdfResponse.arrayBuffer()
      );

      const packageName = process.env.LOCAL_PDF_MODULE ?? "pdf-parse";
      const { PDFParse } = await import(/* webpackIgnore: true */ packageName) as typeof import("pdf-parse");
      const parser = new PDFParse({
        data: buffer,
      });

      const result = await parser.getText();

      await parser.destroy();

      const text = result.text
        .replace(/\s+/g, " ")
        .trim();

      /*
       * The monthly PDF begins with text such as:
       *
       * Monthly Report: September 2026
       *
       * Firms’ year-ahead unit cost expectations increased
       * to 2.4 percent.
       */

      const dateMatch = text.match(
        /Monthly Report:\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
      );

      const valuePatterns =
        series === "price"
          ? [
              /Firms['’]\s+year-ahead\s+price\s+expectations[\s\S]{0,160}?\b(\d+(?:\.\d+)?)\s*percent/i,
              /year-ahead\s+price\s+expectations[\s\S]{0,160}?\b(\d+(?:\.\d+)?)\s*percent/i,
              /expected\s+price\s+increase[\s\S]{0,160}?\b(\d+(?:\.\d+)?)\s*percent/i,
            ]
          : [
              /Firms['’]\s+year-ahead\s+unit\s+cost\s+expectations[\s\S]{0,160}?\b(\d+(?:\.\d+)?)\s*percent/i,
              /year-ahead\s+unit\s+cost\s+expectations[\s\S]{0,160}?\b(\d+(?:\.\d+)?)\s*percent/i,
            ];

      const valueMatch = valuePatterns
        .map((pattern) => text.match(pattern))
        .find(Boolean);

      if (!dateMatch || !valueMatch) {
        continue;
      }

      const monthName = dateMatch[1];
      const year = dateMatch[2];
      const value = Number(valueMatch[1]);

      const monthMap: Record<string, string> = {
        january: "01",
        february: "02",
        march: "03",
        april: "04",
        may: "05",
        june: "06",
        july: "07",
        august: "08",
        september: "09",
        october: "10",
        november: "11",
        december: "12",
      };

      const month = monthMap[monthName.toLowerCase()];

      if (!month || !Number.isFinite(value)) {
        continue;
      }

      points.push({
        date: `${year}-${month}-01`,
        value,
      });
    } catch {
      continue;
    }
  }

  const finalPoints = dedupeAndSort(points);

  if (!finalPoints.length) {
    throw new Error(
      `Atlanta Fed BIE (${series}): no ${currentYear} observations could be parsed`
    );
  }
console.log("ATLANTA BIE PDF LINKS:", pdfLinks);
console.log("ATLANTA BIE POINTS:", finalPoints);
  return finalPoints;
}

const CLEVELAND_SOFIE_URL =
  "https://www.clevelandfed.org/-/media/files/webcharts/survey_of_firms/sofie_statistics.xlsx";

export async function fetchClevelandSofieSeries(
  horizon: "1y" | "5y"
): Promise<RawPoint[]> {
  /*
   * The Cleveland page publishes the historical SoFIE tables
   * directly. We use the official page as the authoritative
   * source for the series rather than relying on an unknown
   * workbook column layout.
   *
   * 1Y:
   *   Table 1
   *
   * 5Y:
   *   Table 2C
   */

  const pageUrl =
    "https://www.clevelandfed.org/indicators-and-data/survey-of-firms-inflation-expectations";

  const response = await fetch(pageUrl, {
    headers: {
      Accept: "text/html,*/*",
      "User-Agent": "MacroHub/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Cleveland Fed SoFIE page request failed: HTTP ${response.status}`
    );
  }

  const html = await response.text();

  const points =
    horizon === "1y"
      ? parseClevelandSofie1Y(html)
      : parseClevelandSofie5Y(html);

  if (points.length) {
    return points;
  }

  /*
   * If the page structure changes, fall back to the official
   * workbook. This is still preferable to returning fabricated
   * observations.
   */
  return fetchClevelandSofieWorkbook(
    horizon,
    CLEVELAND_SOFIE_URL
  );
}


/**
 * Parse Table 1:
 *
 * Date (YYYY.Q) | Mean (%) | Standard deviation
 */
function parseClevelandSofie1Y(
  html: string
): RawPoint[] {
  const table =
    extractClevelandTable(
      html,
      "Table 1: Expected CPI inflation over the next 12 months"
    );

  if (!table) {
    return [];
  }

  return parseQuarterlyMeanTable(table);
}


/**
 * Parse Table 2C:
 *
 * Date (YYYY.Q) | Mean (%) | Standard deviation
 */
function parseClevelandSofie5Y(html: string): RawPoint[] {
  const lower = html.toLowerCase();

  const title =
    "table 2c: expected average cpi inflation over the next 5 years";

  const titleIndex = lower.indexOf(title);

  if (titleIndex === -1) {
    return [];
  }

  const section = html.slice(titleIndex);

  const rows =
    section.match(
      /<tr[\s\S]*?<\/tr>/gi
    ) ?? [];

  const points: RawPoint[] = [];

  for (const row of rows) {
    const cells =
      row
        .match(
          /<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi
        )
        ?.map(stripHtml)
        .map((x) => x.trim()) ?? [];

    if (cells.length < 2) {
      continue;
    }

    const date = normalizeQuarterDate(cells[0]);
    const value = normalizeNumber(cells[1]);

    if (!date || value === null) {
      continue;
    }

    points.push({
      date,
      value,
    });
  }

  return dedupeAndSort(points);
}

/**
 * Extract a Cleveland HTML table from the page.
 */
function extractClevelandTable(
  html: string,
  title: string
): string | null {
  const titleIndex =
    html.toLowerCase().indexOf(
      title.toLowerCase()
    );

  if (titleIndex === -1) {
    return null;
  }

  const afterTitle =
    html.slice(titleIndex);

  const tableStart =
    afterTitle.indexOf("<table");

  if (tableStart === -1) {
    return null;
  }

  const tableEnd =
    afterTitle.indexOf(
      "</table>",
      tableStart
    );

  if (tableEnd === -1) {
    return null;
  }

  return afterTitle.slice(
    tableStart,
    tableEnd + "</table>".length
  );
}


/**
 * Parse Cleveland table rows.
 *
 * Expected row shape:
 *
 * 2018.2 | 3.2 | 1.7
 */
function parseQuarterlyMeanTable(
  tableHtml: string
): RawPoint[] {
  const rows =
    tableHtml.match(
      /<tr[\s\S]*?<\/tr>/gi
    ) ?? [];

  const points: RawPoint[] = [];

  for (const row of rows) {
    const cells =
      row
        .match(
          /<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi
        )
        ?.map(stripHtml)
        .map((x) => x.trim()) ?? [];

    if (cells.length < 2) {
      continue;
    }

    const date =
      normalizeQuarterDate(cells[0]);

    const value =
      normalizeNumber(cells[1]);

    if (!date || value === null) {
      continue;
    }

    points.push({
      date,
      value,
    });
  }

  return dedupeAndSort(points);
}


/**
 * Official workbook fallback.
 *
 * We deliberately support common spreadsheet layouts but do
 * not invent a column if the workbook cannot be identified.
 */
async function fetchClevelandSofieWorkbook(
  horizon: "1y" | "5y",
  url: string
): Promise<RawPoint[]> {
  const response = await fetch(url, {
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      "User-Agent": "MacroHub/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Cleveland Fed SoFIE workbook request failed: HTTP ${response.status}`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  return parseExcelPoints(
    buffer,
    horizon === "1y"
      ? "cleveland-sofie-1y"
      : "cleveland-sofie-5y"
  );
}


/* =========================================================
   UNIVERSITY OF MICHIGAN — PX5
   ========================================================= */

/**
 * Official UMich data endpoint.
 *
 * PX5 = Expected Change in Prices During the Next 5 Years.
 */
const UMICH_PX5_URL =
  "https://www.sca.isr.umich.edu/files/tbmpx1px5.csv";


export async function fetchUmichPx5Series(): Promise<RawPoint[]> {
  const configuredUrl =
    process.env.UMICH_PX5_URL;

  const url =
    configuredUrl || UMICH_PX5_URL;

  const response = await fetch(url, {
    headers: {
      Accept:
        "text/csv,application/csv,text/plain,application/octet-stream,*/*",
      "User-Agent": "Mozilla/5.0 MacroHub/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `University of Michigan PX5 request failed: HTTP ${response.status}`
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "";

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  /*
   * UMich can serve this file with application/octet-stream
   * rather than text/csv. Therefore we intentionally inspect
   * the body instead of relying only on content-type.
   */

  if (
    contentType.includes("spreadsheet") ||
    contentType.includes("excel") ||
    url.toLowerCase().endsWith(".xlsx") ||
    url.toLowerCase().endsWith(".xls")
  ) {
    return parseExcelPoints(
      buffer,
      "umich-px5"
    );
  }

  const text =
    buffer
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim();

  if (!text) {
    return [];
  }

  /*
   * If the endpoint unexpectedly returns JSON, support it.
   */
  if (
    contentType.includes("json") ||
    text.startsWith("{") ||
    text.startsWith("[")
  ) {
    return normalizeGenericPoints(
      JSON.parse(text)
    );
  }

  /*
   * Primary UMich PX5 parser.
   */
  const points =
    parseUmichPx5Csv(text);

  if (points.length) {
    return points;
  }

  /*
   * Some UMich downloads contain metadata / title rows
   * before the actual CSV header. Try a more permissive
   * row-scanning parser before giving up.
   */
  const scannedPoints =
    parseUmichPx5Loose(text);

  if (scannedPoints.length) {
    return scannedPoints;
  }

  return [];
}


/**
 * UMich CSV parser.
 *
 * Handles:
 *
 *   DATE,PX1,PX5
 *
 * as well as provider-specific verbose headers.
 *
 * The parser is deliberately tolerant of:
 * - UTF-8 BOM
 * - quoted CSV
 * - metadata rows
 * - PX5 / PX5_MD naming
 * - verbose PX5 descriptions
 * - YYYY-MM
 * - MM/YYYY
 * - normal date strings
 */
function parseUmichPx5Csv(text: string): RawPoint[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);

  const monthIndex = findHeaderIndex(headers, [
    "month",
  ]);

  const yearIndex = findHeaderIndex(headers, [
    "yyyy",
    "year",
  ]);

  const valueIndex = findHeaderIndex(headers, [
    "px5_md",
    "px5 md",
    "px5",
  ]);

  if (
    monthIndex === -1 ||
    yearIndex === -1 ||
    valueIndex === -1
  ) {
    return [];
  }

  const monthMap: Record<string, number> = {
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

  const points: RawPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const columns = splitCsvLine(lines[i]);

    if (
      columns.length <=
      Math.max(monthIndex, yearIndex, valueIndex)
    ) {
      continue;
    }

    const monthText = columns[monthIndex]
      ?.trim()
      .toLowerCase();

    const year = Number(
      columns[yearIndex]?.trim()
    );

    const month = monthMap[monthText];

    const value = normalizeNumber(
      columns[valueIndex]
    );

    if (
      !month ||
      !Number.isInteger(year) ||
      year < 1900 ||
      value === null
    ) {
      continue;
    }

    points.push({
      date: `${year}-${String(month).padStart(2, "0")}-01`,
      value,
    });
  }

  return dedupeAndSort(points);
}
/**
 * Extra-tolerant UMich parser.
 *
 * This is used when the official download doesn't expose
 * a conventional CSV header.
 *
 * It looks for rows containing a recognizable date followed
 * by one or more numeric fields. The PX5 value is selected
 * using the following rules:
 *
 * 1. A column whose header contains PX5.
 * 2. A column whose header contains "5 year".
 * 3. If no header exists and there are two columns:
 *      date,value
 * 4. Otherwise use the last numeric field on the row.
 *
 * This fallback never fabricates a value; it only parses
 * an actual numeric value present in the official response.
 */
function parseUmichPx5Loose(
  text: string
): RawPoint[] {
  const lines =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  /*
   * Look for a header anywhere near the beginning.
   */
  let headerIndex = -1;
  let headers: string[] = [];

  for (
    let i = 0;
    i < Math.min(lines.length, 50);
    i++
  ) {
    const candidate =
      splitCsvLine(lines[i])
        .map(normalizeHeader);

    const joined =
      candidate.join(" ");

    if (
      candidate.some(
        (x) =>
          x === "date" ||
          x === "month" ||
          x === "period" ||
          x.includes("observation date")
      ) &&
      (
        joined.includes("px5") ||
        joined.includes("5 year") ||
        joined.includes("five year") ||
        candidate.length === 2
      )
    ) {
      headerIndex = i;
      headers = candidate;
      break;
    }
  }

  /*
   * If a header was found, try to use it.
   */
  if (headerIndex !== -1) {
    const dateIndex =
      findHeaderIndex(headers, [
        "date",
        "month",
        "period",
        "observation date",
        "observation_date",
        "year month",
        "yyyymm",
      ]);

    let valueIndex =
      findHeaderIndex(headers, [
        "px5",
        "px5 md",
        "px5_md",
        "five year inflation expectation",
        "five-year inflation expectation",
        "5 year inflation expectation",
        "5-year inflation expectation",
        "expected change in prices during the next 5 years",
        "expected change in prices during the next five years",
      ]);

    if (
      valueIndex === -1
    ) {
      valueIndex =
        headers.findIndex((header) => {
          return (
            header.includes("px5") ||
            header.includes("five year") ||
            header.includes("5 year")
          );
        });
    }

    if (
      valueIndex === -1 &&
      headers.length === 2
    ) {
      valueIndex = 1;
    }

    if (
      dateIndex !== -1 &&
      valueIndex !== -1
    ) {
      const points: RawPoint[] = [];

      for (
        let i = headerIndex + 1;
        i < lines.length;
        i++
      ) {
        const columns =
          splitCsvLine(lines[i]);

        if (
          columns.length <=
          Math.max(dateIndex, valueIndex)
        ) {
          continue;
        }

        const date =
          normalizeDate(
            columns[dateIndex]
          );

        const value =
          normalizeNumber(
            columns[valueIndex]
          );

        if (
          !date ||
          value === null
        ) {
          continue;
        }

        points.push({
          date,
          value,
        });
      }

      if (points.length) {
        return dedupeAndSort(points);
      }
    }
  }

  /*
   * Last-resort row parser.
   *
   * We require:
   * - first/one field to parse as a date
   * - at least one real numeric value
   *
   * We do not generate or interpolate anything.
   */
  const points: RawPoint[] = [];

  for (const line of lines) {
    const columns =
      splitCsvLine(line);

    if (
      columns.length < 2
    ) {
      continue;
    }

    let dateIndex = -1;
    let date: string | null = null;

    for (
      let i = 0;
      i < columns.length;
      i++
    ) {
      const candidate =
        normalizeDate(columns[i]);

      if (candidate) {
        dateIndex = i;
        date = candidate;
        break;
      }
    }

    if (
      dateIndex === -1 ||
      !date
    ) {
      continue;
    }

    const numericValues: Array<{
      index: number;
      value: number;
    }> = [];

    for (
      let i = 0;
      i < columns.length;
      i++
    ) {
      if (i === dateIndex) {
        continue;
      }

      const value =
        normalizeNumber(columns[i]);

      if (value !== null) {
        numericValues.push({
          index: i,
          value,
        });
      }
    }

    if (!numericValues.length) {
      continue;
    }

    /*
     * For an unlabelled two-column file, this is simply
     * date,value.
     *
     * For a multi-column provider export without headers,
     * the last numeric field is used. This mirrors the
     * common UMich PX5 export layout while still requiring
     * an actual value from the response.
     */
    const selected =
      numericValues[
        numericValues.length - 1
      ];

    if (!selected) {
      continue;
    }

    points.push({
      date,
      value: selected.value,
    });
  }

  return dedupeAndSort(points);
}


/* =========================================================
   GENERIC JSON
   ========================================================= */

function normalizeGenericPoints(
  input: unknown
): RawPoint[] {
  if (!Array.isArray(input)) {
    if (
      input &&
      typeof input === "object" &&
      "data" in input
    ) {
      return normalizeGenericPoints(
        (input as { data: unknown }).data
      );
    }

    return [];
  }

  const points: RawPoint[] = [];

  for (const row of input) {
    if (
      !row ||
      typeof row !== "object"
    ) {
      continue;
    }

    const record =
      row as Record<string, unknown>;

    const date =
      normalizeDate(
        record.date ??
          record.Date ??
          record.period ??
          record.Period ??
          record.month ??
          record.Month ??
          record.observation_date ??
          record.observationDate
      );

    const value =
      normalizeNumber(
        record.value ??
          record.Value ??
          record.px5 ??
          record.PX5 ??
          record.PX5_MD ??
          record.expectedInflation ??
          record.expected_inflation ??
          record.expectedChangeInPrices
      );

    if (
      !date ||
      value === null
    ) {
      continue;
    }

    points.push({
      date,
      value,
    });
  }

  return dedupeAndSort(points);
}


/* =========================================================
   GENERIC CSV
   ========================================================= */

function normalizeCsvPoints(
  text: string
): RawPoint[] {
  const lines =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers =
    splitCsvLine(lines[0]).map(
      normalizeHeader
    );

  const dateIndex =
    findHeaderIndex(headers, [
      "date",
      "period",
      "month",
      "observation date",
      "observation_date",
    ]);

  const valueIndex =
    findHeaderIndex(headers, [
      "value",
      "expected inflation",
      "expected_inflation",
      "inflation expectation",
      "expected change in prices",
      "inflation expectations",
    ]);

  if (
    dateIndex === -1 ||
    valueIndex === -1
  ) {
    return [];
  }

  const points: RawPoint[] = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const columns =
      splitCsvLine(lines[i]);

    if (
      columns.length <=
      Math.max(dateIndex, valueIndex)
    ) {
      continue;
    }

    const date =
      normalizeDate(
        columns[dateIndex]
      );

    const value =
      normalizeNumber(
        columns[valueIndex]
      );

    if (
      !date ||
      value === null
    ) {
      continue;
    }

    points.push({
      date,
      value,
    });
  }

  return dedupeAndSort(points);
}


/* =========================================================
   EXCEL
   ========================================================= */

/**
 * IMPORTANT:
 *
 * This requires the `xlsx` package.
 *
 * Install if it is not already present:
 *
 *   npm install xlsx
 */
function parseExcelPoints(
  buffer: Buffer,
  series: string
): RawPoint[] {
  /*
   * Lazy require keeps this module compatible with the
   * current ingest architecture while avoiding a hard
   * dependency at module initialization.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");

  const workbook =
    XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

  const points: RawPoint[] = [];

  for (
    const sheetName of workbook.SheetNames
  ) {
    const sheet =
      workbook.Sheets[sheetName];

    const rows =
      XLSX.utils.sheet_to_json(
        sheet,
        {
          header: 1,
          defval: null,
          raw: false,
        }
      ) as unknown[][];

    if (rows.length < 2) {
      continue;
    }

    /*
     * Find a header row rather than assuming row 1.
     */
    const headerRowIndex =
      findExcelHeaderRow(rows);

    if (headerRowIndex === -1) {
      continue;
    }

    const headers =
      (rows[headerRowIndex] ?? []).map(
        (value) =>
          normalizeHeader(
            String(value ?? "")
          )
      );

    const dateIndex =
      findHeaderIndex(headers, [
        "date",
        "period",
        "month",
        "quarter",
        "observation date",
        "observation_date",
      ]);

    if (dateIndex === -1) {
      continue;
    }

    const valueIndex =
      findExcelValueColumn(
        headers,
        series
      );

    if (valueIndex === -1) {
      continue;
    }

    for (
      let i = headerRowIndex + 1;
      i < rows.length;
      i++
    ) {
      const row =
        rows[i] ?? [];

      const date =
        normalizeDate(
          row[dateIndex]
        );

      const value =
        normalizeNumber(
          row[valueIndex]
        );

      if (
        !date ||
        value === null
      ) {
        continue;
      }

      points.push({
        date,
        value,
      });
    }
  }

  return dedupeAndSort(points);
}


function findExcelHeaderRow(
  rows: unknown[][]
): number {
  const max =
    Math.min(rows.length, 40);

  for (
    let i = 0;
    i < max;
    i++
  ) {
    const headers =
      (rows[i] ?? []).map(
        (value) =>
          normalizeHeader(
            String(value ?? "")
          )
      );

    const hasDate =
      findHeaderIndex(headers, [
        "date",
        "period",
        "month",
        "quarter",
        "observation date",
        "observation_date",
      ]) !== -1;

    if (hasDate) {
      return i;
    }
  }

  return -1;
}


function findExcelValueColumn(
  headers: string[],
  series: string
): number {
  const candidates =
    series === "cleveland-sofie-1y"
      ? [
          "mean",
          "expected inflation",
          "expected cpi inflation",
          "1 year",
          "1-year",
          "12 months",
        ]
      : series === "cleveland-sofie-5y"
      ? [
          "mean",
          "expected average cpi inflation",
          "5 year",
          "5-year",
          "next 5 years",
        ]
      : series === "umich-px5"
      ? [
          "px5",
          "px5 md",
          "px5_md",
          "five year inflation expectation",
          "five-year inflation expectation",
          "expected change in prices during the next 5 years",
          "expected change in prices during the next five years",
        ]
      : series === "atlanta-bie"
      ? [
          "bie",
          "expected price change",
          "expected price increase",
          "inflation expectation",
          "expected inflation",
          "1 year",
          "12 months",
        ]
      : [
          "value",
          "mean",
          "expected inflation",
        ];

  return findHeaderIndex(
    headers,
    candidates
  );
}


/* =========================================================
   HELPERS
   ========================================================= */

function findHeaderIndex(
  headers: string[],
  candidates: string[]
): number {
  /*
   * First: exact matches.
   */
  for (
    const candidate of candidates
  ) {
    const normalized =
      normalizeHeader(candidate);

    const exact =
      headers.indexOf(normalized);

    if (exact !== -1) {
      return exact;
    }
  }

  /*
   * Second: contains matching for provider-specific
   * verbose column names.
   */
  for (
    let i = 0;
    i < headers.length;
    i++
  ) {
    const header =
      headers[i];

    if (
      candidates.some(
        (candidate) => {
          const normalized =
            normalizeHeader(candidate);

          return (
            header.includes(normalized) ||
            normalized.includes(header)
          );
        }
      )
    ) {
      return i;
    }
  }

  return -1;
}


function splitCsvLine(
  line: string
): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char =
      line[i];

    if (char === '"') {
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
        continue;
      }

      quoted = !quoted;
      continue;
    }

    if (
      char === "," &&
      !quoted
    ) {
      result.push(
        current.trim()
      );

      current = "";
      continue;
    }

    current += char;
  }

  result.push(
    current.trim()
  );

  return result;
}


function stripHtml(
  value: string
): string {
  return value
    .replace(
      /<br\s*\/?>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      ""
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function normalizeHeader(
  value: string
): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(
      /[–—-]/g,
      " "
    )
    .replace(
      /[_/]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function normalizeNumber(
  value: unknown
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
      ? value
      : null;
  }

  const text =
    String(value)
      .replace(
        /%/g,
        ""
      )
      .replace(
        /,/g,
        ""
      )
      .trim();

  if (
    !text ||
    text === "." ||
    text === "-" ||
    text.toLowerCase() === "na" ||
    text.toLowerCase() === "n/a" ||
    text.toLowerCase() === "null"
  ) {
    return null;
  }

  const number =
    Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}


/**
 * Converts:
 *
 * 2018.2 -> 2018-04-01
 * 2018.3 -> 2018-07-01
 * 2018.4 -> 2018-10-01
 * 2019.1 -> 2019-01-01
 */
function normalizeQuarterDate(
  value: unknown
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value)
      .trim();

  const match =
    text.match(
      /^(\d{4})[.\-_/ ]Q?([1-4])$/i
    ) ??
    text.match(
      /^(\d{4})\.([1-4])$/
    );

  if (!match) {
    return normalizeDate(
      value
    );
  }

  const year =
    Number(match[1]);

  const quarter =
    Number(match[2]);

  const month =
    (quarter - 1) * 3 + 1;

  return `${year}-${String(
    month
  ).padStart(2, "0")}-01`;
}


function normalizeDate(
  value: unknown
): string | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (
    value instanceof Date
  ) {
    if (
      Number.isNaN(
        value.getTime()
      )
    ) {
      return null;
    }

    return `${value.getUTCFullYear()}-${String(
      value.getUTCMonth() + 1
    ).padStart(2, "0")}-01`;
  }

  const text =
    String(value)
      .trim()
      .replace(/^\uFEFF/, "");

  /*
   * Cleveland quarter format.
   */
  if (
    /^\d{4}[.][1-4]$/.test(text)
  ) {
    return normalizeQuarterDate(
      text
    );
  }

  /*
   * YYYY-MM / YYYY/MM / YYYY M01.
   */
  const ym =
    text.match(
      /^(\d{4})[-/ ](?:M)?(\d{1,2})$/i
    );

  if (ym) {
    const year =
      Number(ym[1]);

    const month =
      Number(ym[2]);

    if (
      month >= 1 &&
      month <= 12
    ) {
      return `${year}-${String(
        month
      ).padStart(2, "0")}-01`;
    }
  }

  /*
   * YYYYMM.
   */
  const yyyymm =
    text.match(
      /^(\d{4})(\d{2})$/
    );

  if (yyyymm) {
    const year =
      Number(yyyymm[1]);

    const month =
      Number(yyyymm[2]);

    if (
      month >= 1 &&
      month <= 12
    ) {
      return `${year}-${String(
        month
      ).padStart(2, "0")}-01`;
    }
  }

  /*
   * MM/YYYY.
   */
  const my =
    text.match(
      /^(\d{1,2})[-/](\d{4})$/
    );

  if (my) {
    const month =
      Number(my[1]);

    const year =
      Number(my[2]);

    if (
      month >= 1 &&
      month <= 12
    ) {
      return `${year}-${String(
        month
      ).padStart(2, "0")}-01`;
    }
  }

  /*
   * Month name + year:
   *
   * January 2026
   * Jan 2026
   */
  const monthName =
    text.match(
      /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i
    );

  if (monthName) {
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };

    const month =
      monthMap[
        monthName[1].toLowerCase()
      ];

    const year =
      Number(monthName[2]);

    if (
      month &&
      year
    ) {
      return `${year}-${String(
        month
      ).padStart(2, "0")}-01`;
    }
  }

  const parsed =
    new Date(text);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return `${parsed.getUTCFullYear()}-${String(
    parsed.getUTCMonth() + 1
  ).padStart(2, "0")}-01`;
}


function dedupeAndSort(
  points: RawPoint[]
): RawPoint[] {
  const byDate =
    new Map<string, RawPoint>();

  for (
    const point of points
  ) {
    byDate.set(
      point.date,
      point
    );
  }

  return [
    ...byDate.values(),
  ].sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}
