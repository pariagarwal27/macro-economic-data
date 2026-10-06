import * as XLSX from "xlsx";

import type { RawPoint } from "./transforms";

const SCE_DATA_URL =
  "https://www.newyorkfed.org/medialibrary/interactives/sce/sce/downloads/data/frbny-sce-data.xlsx";


export type NyfedSeriesId =
  | "SCE_INFLATION_1Y"
  | "SCE_INFLATION_3Y"
  | "SCE_INFLATION_5Y"
  | "SCE_LABOR_EARNINGS_1Y"
  | "SCE_LABOR_JOB_SEPARATION_1Y"
  | "SCE_LABOR_JOB_FINDING_1Y"
  | "SCE_LABOR_UNEMPLOYMENT_1Y"
  | "SCE_FINANCE_INCOME_1Y"
  | "SCE_FINANCE_SPENDING_1Y"
  | "SCE_FINANCE_TAX_1Y"
  | "SCE_INFLATION_UNCERTAINTY_1Y";

export interface NyFedSceResult {
  oneYear: RawPoint[];
  threeYear: RawPoint[];
  fiveYear: RawPoint[];
}

/**
 * Fetch the official New York Fed Survey of Consumer Expectations
 * workbook and extract:
 *
 * - Median one-year ahead expected inflation
 * - Median three-year ahead expected inflation
 * - Five-year ahead expected inflation
 */
export async function fetchNyFedSceInflationExpectations(): Promise<NyFedSceResult> {
  const res = await fetch(SCE_DATA_URL, {
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel",
      "User-Agent": "MacroHub/1.0",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `NY Fed SCE download failed: HTTP ${res.status}`
    );
  }

  const buffer = Buffer.from(
    await res.arrayBuffer()
  );

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });

  /*
   * ------------------------------------------------------------
   * 1Y + 3Y
   * ------------------------------------------------------------
   *
   * Current NY Fed workbook:
   *
   * Row 1  -> source/disclaimer
   * Row 2  -> "Inflation expectations"
   * Row 3  -> blank
   * Row 4  -> actual column headers
   * Row 5+ -> data
   *
   * Therefore we must read the worksheet as a matrix
   * instead of using sheet_to_json() with automatic headers.
   */

  const inflationSheet = findSheetByName(
    workbook,
    "Inflation expectations"
  );

  if (!inflationSheet) {
    throw new Error(
      `NY Fed SCE inflation expectations worksheet not found. Available sheets: ${workbook.SheetNames.join(
        ", "
      )}`
    );
  }

  const inflationRows =
    readMatrix(inflationSheet);

  const oneYear =
    extractInflationSeries(
      inflationRows,
      "oneYear"
    );

  const threeYear =
    extractInflationSeries(
      inflationRows,
      "threeYear"
    );

  /*
   * ------------------------------------------------------------
   * 5Y
   * ------------------------------------------------------------
   *
   * The current NY Fed workbook exposes 5Y through:
   *
   *   Five-year ahead Infl Exp
   *
   * This sheet can have a slightly different layout,
   * so we detect the actual header/value column.
   */

  const fiveYearSheet =
    findSheetByName(
      workbook,
      "Five-year ahead Infl Exp"
    );

  let fiveYear: RawPoint[] = [];

  if (fiveYearSheet) {
    const fiveYearRows =
      readMatrix(fiveYearSheet);

    fiveYear =
      extractFiveYearSeries(
        fiveYearRows
      );
  }

  /*
   * ------------------------------------------------------------
   * Validation
   * ------------------------------------------------------------
   */

  if (!oneYear.length) {
    throw new Error(
      "NY Fed SCE 1Y inflation expectation series is empty"
    );
  }

  if (!threeYear.length) {
    throw new Error(
      "NY Fed SCE 3Y inflation expectation series is empty"
    );
  }

  if (!fiveYear.length) {
    throw new Error(
      "NY Fed SCE 5Y inflation expectation series is empty"
    );
  }

  return {
    oneYear,
    threeYear,
    fiveYear,
  };
}

/**
 * Read an Excel worksheet as a raw matrix.
 *
 * We use header: 1 because the NY Fed workbook
 * does not put the actual headers in row 1.
 */
function readMatrix(
  sheet: XLSX.WorkSheet
): unknown[][] {
  return XLSX.utils.sheet_to_json(
    sheet,
    {
      header: 1,
      defval: null,
      raw: true,
    }
  ) as unknown[][];
}

/**
 * Find a worksheet by normalized name.
 *
 * Handles small differences such as:
 *
 * Inflation expectations
 * Inflation Expectations
 */
function findSheetByName(
  workbook: XLSX.WorkBook,
  wantedName: string
): XLSX.WorkSheet | null {
  const wanted =
    normalizeHeader(wantedName);

  const actualName =
    workbook.SheetNames.find(
      (name) =>
        normalizeHeader(name) ===
        wanted
    );

  if (!actualName) {
    return null;
  }

  return (
    workbook.Sheets[actualName] ??
    null
  );
}

/**
 * Extract either:
 *
 * - Median one-year ahead expected inflation
 * - Median three-year ahead expected inflation
 *
 * from the matrix-based Inflation expectations sheet.
 */
function extractInflationSeries(
  rows: unknown[][],
  type: "oneYear" | "threeYear"
): RawPoint[] {
  if (!rows.length) {
    return [];
  }

  const target =
    type === "oneYear"
      ? "median one year ahead expected inflation rate"
      : "median three year ahead expected inflation rate";

  /*
   * Find the actual header row.
   */
  const headerRowIndex =
    rows.findIndex((row) =>
      row.some(
        (cell) =>
          typeof cell === "string" &&
          normalizeHeader(cell).includes(
            target
          )
      )
    );

  if (headerRowIndex === -1) {
    return [];
  }

  const headerRow =
    rows[headerRowIndex];

  /*
   * Find the exact value column.
   */
  const valueColumnIndex =
    headerRow.findIndex(
      (cell) =>
        typeof cell === "string" &&
        normalizeHeader(cell) ===
          target
    );

  if (valueColumnIndex === -1) {
    return [];
  }

  /*
   * Current NY Fed workbook uses the
   * first column for YYYYMM.
   */
  const dateColumnIndex = 0;

  const points: RawPoint[] = [];

  for (
    let rowIndex =
      headerRowIndex + 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row =
      rows[rowIndex];

    if (!row) {
      continue;
    }

    const date =
      normalizeSceDate(
        row[dateColumnIndex]
      );

    const value =
      normalizeNumber(
        row[valueColumnIndex]
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

/**
 * Extract the 5Y series from:
 *
 *   Five-year ahead Infl Exp
 *
 * The workbook layout can change slightly, so
 * we detect the header/value column rather than
 * relying on a fixed column number.
 */
function extractFiveYearSeries(rows: unknown[][]): RawPoint[] {
  if (!rows.length) return [];

  for (let headerRowIndex = 0; headerRowIndex < rows.length; headerRowIndex++) {
    const headerRow = rows[headerRowIndex];
    if (!headerRow?.length) continue;

    const dateColumnIndex = findDateColumnIndex(rows, headerRowIndex);
    if (dateColumnIndex === -1) continue;

    const candidates = headerRow
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell, index }) => {
        if (index === dateColumnIndex || typeof cell !== "string") return false;
        const h = normalizeHeader(cell);
        return (
          h.includes("inflation") &&
          (h.includes("five year") || h.includes("five-year") || h.includes("5 year") || h.includes("5-year") || h.includes("expected")) &&
          !h.includes("25th percentile") &&
          !h.includes("75th percentile")
        );
      });

    if (!candidates.length) continue;

    const preferred =
      candidates.find(({ cell }) => typeof cell === "string" && normalizeHeader(cell).includes("median")) ??
      candidates.find(({ cell }) => typeof cell === "string" && normalizeHeader(cell).includes("mean")) ??
      candidates[0];

    const points: RawPoint[] = [];
    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!row) continue;

      const date = normalizeSceDate(row[dateColumnIndex]);
      const value = normalizeNumber(row[preferred.index]);

      if (!date || value === null || isSceDateValue(row[preferred.index])) continue;
      points.push({ date, value });
    }

    const cleaned = dedupeAndSort(points);
    if (cleaned.length) return cleaned;
  }

  return [];
}

function findDateColumnIndex(
  rows: unknown[][],
  headerRowIndex: number
): number {
  const headerRow =
    rows[headerRowIndex];

  if (!headerRow) {
    return -1;
  }

  /*
   * Prefer an explicitly named date/month column.
   */
  const namedIndex =
    headerRow.findIndex(
      (cell) => {
        if (
          typeof cell !== "string"
        ) {
          return false;
        }

        const header =
          normalizeHeader(cell);

        return (
          header === "date" ||
          header === "month" ||
          header === "period" ||
          header === "time"
        );
      }
    );

  if (namedIndex !== -1) {
    return namedIndex;
  }

  /*
   * Current NY Fed SCE workbook uses
   * the first column as YYYYMM.
   */
  for (
    let columnIndex = 0;
    columnIndex <
    headerRow.length;
    columnIndex++
  ) {
    for (
      let rowIndex =
        headerRowIndex + 1;
      rowIndex <
        Math.min(
          rows.length,
          headerRowIndex + 10
        );
      rowIndex++
    ) {
      const value =
        rows[rowIndex]?.[
          columnIndex
        ];

      if (
        isSceDateValue(value)
      ) {
        return columnIndex;
      }
    }
  }

  return -1;
}

/**
 * Check whether a value looks like
 * an SCE YYYYMM date.
 */
function isSceDateValue(
  value: unknown
): boolean {
  if (
    typeof value === "number"
  ) {
    const text =
      String(Math.trunc(value));

    return /^\d{6}$/.test(text);
  }

  if (
    typeof value === "string"
  ) {
    const text =
      value.trim();

    return (
      /^\d{6}$/.test(text) ||
      /^\d{4}[-/]\d{1,2}$/.test(
        text
      ) ||
      /^\d{4}M\d{1,2}$/i.test(
        text
      )
    );
  }

  return value instanceof Date;
}

/**
 * Normalize workbook headers.
 */
function normalizeHeader(
  value: string
): string {
  return value
    .toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize numeric values.
 */
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
      .replace("%", "")
      .replace(/,/g, "")
      .trim();

  if (
    !text ||
    text === "." ||
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
 * Normalize SCE dates.
 *
 * Current workbook uses values such as:
 *
 * 201306
 * 201307
 * 201401
 */
function normalizeSceDate(
  value: unknown
): string | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  /*
   * Actual JavaScript Date.
   */
  if (value instanceof Date) {
    if (
      Number.isNaN(
        value.getTime()
      )
    ) {
      return null;
    }

    return [
      value.getUTCFullYear(),
      String(
        value.getUTCMonth() + 1
      ).padStart(2, "0"),
      "01",
    ].join("-");
  }

  const text =
    String(value).trim();

  /*
   * Current NY Fed format:
   *
   * 201306
   * 201307
   * 202601
   */
  const compact =
    text.match(
      /^(\d{4})(\d{2})$/
    );

  if (compact) {
    const year =
      Number(compact[1]);

    const month =
      Number(compact[2]);

    if (
      year >= 1900 &&
      month >= 1 &&
      month <= 12
    ) {
      return `${year}-${String(
        month
      ).padStart(2, "0")}-01`;
    }
  }

  /*
   * Also support:
   *
   * 2013M06
   * 2013-06
   * 2013/06
   */
  const ym =
    text.match(
      /^(\d{4})[^\d]?M?(\d{1,2})$/i
    );

  if (ym) {
    const year =
      Number(ym[1]);

    const month =
      Number(ym[2]);

    if (
      year >= 1900 &&
      month >= 1 &&
      month <= 12
    ) {
      return `${year}-${String(
        month
      ).padStart(2, "0")}-01`;
    }
  }

  /*
   * Last fallback for normal date strings.
   */
  const parsed =
    new Date(text);

  if (
    !Number.isNaN(
      parsed.getTime()
    )
  ) {
    return [
      parsed.getUTCFullYear(),
      String(
        parsed.getUTCMonth() + 1
      ).padStart(2, "0"),
      "01",
    ].join("-");
  }

  return null;
}

/**
 * Remove duplicate dates and sort ascending.
 */
function dedupeAndSort(
  points: RawPoint[]
): RawPoint[] {
  const byDate =
    new Map<string, RawPoint>();

  for (const point of points) {
    byDate.set(
      point.date,
      point
    );
  }

  return [...byDate.values()].sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}

/**
 * Extract a monthly SCE series from the official workbook by semantic
 * header aliases. This keeps the adapter resilient to small workbook
 * layout/header changes while still requiring an actual official column.
 */
function extractEarningsGrowthSeriesFromWorkbook(
  workbook: XLSX.WorkBook
): RawPoint[] {
  return extractSectionSeriesFromWorkbook(workbook, {
    sectionAliases: [
      "one-year ahead earnings growth expectations",
      "one year ahead earnings growth expectations",
      "earnings growth expectations",
      "earnings growth",
    ],
    valueAliases: [
      "median expected earnings growth",
      "median one-year-ahead expected earnings growth",
      "median one year ahead expected earnings growth",
      "median earnings growth expectations",
    ],
    maxAbsValue: 50,
  });
}

function extractSectionSeriesFromWorkbook(
  workbook: XLSX.WorkBook,
  options: {
    sectionAliases: string[];
    valueAliases: string[];
    maxAbsValue: number;
  }
): RawPoint[] {
  const sections = options.sectionAliases.map(normalizeHeader);
  const values = options.valueAliases.map(normalizeHeader);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = readMatrix(sheet);
    if (!rows.length) continue;

    for (let sectionRowIndex = 0; sectionRowIndex < rows.length; sectionRowIndex++) {
      const sectionRow = rows[sectionRowIndex] ?? [];
      const sectionText = sectionRow
        .filter((cell) => typeof cell === "string")
        .map((cell) => normalizeHeader(String(cell)))
        .join(" ");

      if (!sections.some((alias) => sectionText.includes(alias))) continue;

      const endRow = Math.min(rows.length, sectionRowIndex + 40);

      for (let headerRowIndex = sectionRowIndex; headerRowIndex < endRow; headerRowIndex++) {
        const headerRow = rows[headerRowIndex] ?? [];
        if (!headerRow.length) continue;

        const normalized = headerRow.map((cell) =>
          typeof cell === "string" ? normalizeHeader(cell) : ""
        );

        let valueColumnIndex = normalized.findIndex((header) =>
          values.some((alias) =>
            header === alias || header.includes(alias) || alias.includes(header)
          )
        );

        if (valueColumnIndex === -1 && sections.some((alias) => alias.includes("earnings growth"))) {
          valueColumnIndex = normalized.findIndex(
            (header) =>
              header.includes("earnings") &&
              header.includes("growth") &&
              header.includes("median") &&
              !header.includes("uncertainty")
          );
        }

        if (valueColumnIndex === -1) continue;

        const dateColumnIndex = findDateColumnIndexWithin(rows, headerRowIndex, endRow);
        if (dateColumnIndex === -1 || dateColumnIndex === valueColumnIndex) continue;

        const points: RawPoint[] = [];
        let started = false;
        let blankRows = 0;

        for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex] ?? [];
          const date = normalizeSceDate(row[dateColumnIndex]);

          if (!date) {
            if (started) {
              blankRows += 1;
              if (blankRows >= 3) break;
            }
            continue;
          }

          blankRows = 0;
          const value = normalizeNumber(row[valueColumnIndex]);
          if (value === null || isSceDateValue(row[valueColumnIndex])) continue;
          if (Math.abs(value) > options.maxAbsValue) continue;

          started = true;
          points.push({ date, value });
        }

        const cleaned = dedupeAndSort(points);
        if (cleaned.length >= 3) return cleaned;
      }
    }
  }

  return [];
}

function findDateColumnIndexWithin(
  rows: unknown[][],
  headerRowIndex: number,
  endRow: number
): number {
  const headerRow = rows[headerRowIndex] ?? [];

  const namedIndex = headerRow.findIndex((cell) => {
    if (typeof cell !== "string") return false;
    const header = normalizeHeader(cell);
    return header === "date" || header === "month" || header === "period" || header === "time";
  });
  if (namedIndex !== -1) return namedIndex;

  for (let columnIndex = 0; columnIndex < headerRow.length; columnIndex++) {
    let dateCount = 0;
    for (
      let rowIndex = headerRowIndex + 1;
      rowIndex < Math.min(rows.length, Math.max(headerRowIndex + 12, endRow));
      rowIndex++
    ) {
      if (isSceDateValue(rows[rowIndex]?.[columnIndex])) dateCount++;
      if (dateCount >= 2) return columnIndex;
    }
  }

  return -1;
}

function extractSeriesByAliasesFromWorkbook(
  workbook: XLSX.WorkBook,
  aliases: string[]
): RawPoint[] {
  const normalizedAliases = aliases.map(normalizeHeader);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = readMatrix(sheet);
    const points = extractSeriesByAliasesFromMatrix(rows, normalizedAliases);
    if (points.length) return points;
  }

  return [];
}

function extractSeriesByAliasesFromMatrix(
  rows: unknown[][],
  normalizedAliases: string[]
): RawPoint[] {
  if (!rows.length) return [];

  for (let headerRowIndex = 0; headerRowIndex < rows.length; headerRowIndex++) {
    const headerRow = rows[headerRowIndex] ?? [];
    if (!headerRow.length) continue;

    const valueColumnIndex = headerRow.findIndex((cell) => {
      if (typeof cell !== "string") return false;
      const header = normalizeHeader(cell);
      return normalizedAliases.some(
        (alias) => header === alias || header.includes(alias) || alias.includes(header)
      );
    });

    if (valueColumnIndex === -1) continue;

    const dateColumnIndex = findDateColumnIndex(rows, headerRowIndex);
    if (dateColumnIndex === -1 || dateColumnIndex === valueColumnIndex) continue;

    const points: RawPoint[] = [];
    let started = false;
    let blankRows = 0;

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] ?? [];
      const date = normalizeSceDate(row[dateColumnIndex]);

      if (!date) {
        if (started) {
          blankRows += 1;
          if (blankRows >= 3) break;
        }
        continue;
      }

      blankRows = 0;
      const value = normalizeNumber(row[valueColumnIndex]);
      if (!date || value === null || isSceDateValue(row[valueColumnIndex])) continue;

      started = true;
      points.push({ date, value });
    }

    const cleaned = dedupeAndSort(points);
    if (cleaned.length) return cleaned;
  }

  return [];
}

async function fetchWorkbookForSeries(
  url: string,
  seriesId: string
): Promise<XLSX.WorkBook> {
  const res = await fetch(url, {
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel",
      "User-Agent": "MacroHub/1.0",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`NY Fed SCE download failed for ${seriesId}: HTTP ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

type NyfedOfficialSeriesConfig = {
  aliases: string[];
  label: string;
};

const NYFED_OFFICIAL_SERIES: Record<
  Exclude<
    NyfedSeriesId,
    "SCE_INFLATION_1Y" |
    "SCE_INFLATION_3Y" |
    "SCE_INFLATION_5Y"
  >,
  NyfedOfficialSeriesConfig
> = {
  SCE_LABOR_EARNINGS_1Y: {
    aliases: [
      "median one year ahead expected earnings growth",
      "median one-year ahead expected earnings growth",
      "median expected earnings growth one year ahead",
      "median expected earnings growth 1 year ahead",
      "median expected earnings growth",
      "median earnings growth expectations",
      "earnings growth expectations",
    ],
    label: "NY Fed SCE earnings growth expectations",
  },

  SCE_LABOR_JOB_SEPARATION_1Y: {
    aliases: [
      "mean perceived probability of losing one's job in the next 12 months",
      "mean perceived probability of losing one’s job in the next 12 months",
      "probability of a job separation",
      "probability of losing one's job",
    ],
    label: "NY Fed SCE job separation probability",
  },

  SCE_LABOR_JOB_FINDING_1Y: {
    aliases: [
      "mean perceived probability of finding a job if one's current job was lost",
      "mean perceived probability of finding a job if one’s current job was lost",
      "probability of finding a job",
      "job finding probability",
    ],
    label: "NY Fed SCE job finding probability",
  },

  SCE_LABOR_UNEMPLOYMENT_1Y: {
    aliases: [
      "mean unemployment expectations",
      "mean perceived probability that the u.s. unemployment rate will be higher one year from now",
      "probability that the u.s. unemployment rate will be higher one year from now",
      "expectations for the u.s. unemployment rate",
    ],
    label: "NY Fed SCE unemployment expectations",
  },

  SCE_FINANCE_INCOME_1Y: {
  aliases: [
    "one-year ahead household income growth expectations",
    "median point prediction",
    "median expected growth in household income",
  ],
  label: "NY Fed SCE household income growth expectations",
},

SCE_FINANCE_SPENDING_1Y: {
  aliases: [
    "one-year ahead household spending growth expectations",
    "median one-year-ahead household spending growth",
    "median nominal household spending growth expectations",
  ],
  label: "NY Fed SCE household spending growth expectations",
},

SCE_FINANCE_TAX_1Y: {
  aliases: [
    "one-year ahead change in taxes",
    "median expectation regarding a year-ahead change in taxes",
    "median expected change in taxes",
  ],
  label: "NY Fed SCE tax change expectations",
},

SCE_INFLATION_UNCERTAINTY_1Y: {
  aliases: [
    "median inflation uncertainty one year",
    "median inflation uncertainty 1 year",
    "inflation uncertainty one year",
    "inflation uncertainty 1 year",
  ],
  label: "NY Fed SCE one-year inflation uncertainty",
},
};

function extractHouseholdFinanceSeries(
  workbook: XLSX.WorkBook,
  seriesId: NyfedSeriesId
): RawPoint[] {
  const sectionTitles: Record<
    "SCE_FINANCE_INCOME_1Y" | "SCE_FINANCE_SPENDING_1Y" | "SCE_FINANCE_TAX_1Y",
    string
  > = {
    SCE_FINANCE_INCOME_1Y:
      "one-year ahead household income growth expectations",
    SCE_FINANCE_SPENDING_1Y:
      "one-year ahead household spending growth expectations",
    SCE_FINANCE_TAX_1Y:
      "one-year ahead change in taxes",
  };

  const wantedSection = normalizeHeader(
    sectionTitles[
      seriesId as keyof typeof sectionTitles
    ]
  );

  if (!wantedSection) return [];

  /*
   * The NY Fed Household Finance tables use the chart/section title
   * to identify the series, while the actual value column is commonly
   * labelled only "Median point prediction".
   *
   * We therefore MUST:
   *   1. Find the correct Household Finance section.
   *   2. Inside that section, find "Median point prediction".
   *   3. Read the monthly YYYYMM date column + that median column.
   *
   * Do not search the entire workbook for "Median point prediction"
   * because all three Household Finance series use that same label.
   */
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = readMatrix(sheet);
    if (!rows.length) continue;

    for (
      let sectionRowIndex = 0;
      sectionRowIndex < rows.length;
      sectionRowIndex++
    ) {
      const sectionRow = rows[sectionRowIndex] ?? [];

      const sectionFound = sectionRow.some((cell) => {
        if (typeof cell !== "string") return false;

        const header = normalizeHeader(cell);

        return (
          header === wantedSection ||
          header.includes(wantedSection) ||
          wantedSection.includes(header)
        );
      });

      if (!sectionFound) continue;

      /*
       * The section title is normally followed by the actual table
       * headers within a few rows. Search only a small bounded area so
       * we never accidentally pick the median column from another chart.
       */
      const endRow = Math.min(
        rows.length,
        sectionRowIndex + 12
      );

      for (
        let headerRowIndex = sectionRowIndex;
        headerRowIndex < endRow;
        headerRowIndex++
      ) {
        const headerRow = rows[headerRowIndex] ?? [];

        const medianColumnIndex = headerRow.findIndex((cell) => {
          if (typeof cell !== "string") return false;

          const header = normalizeHeader(cell);

          return (
            header === "median point prediction" ||
            header.includes("median point prediction")
          );
        });

        if (medianColumnIndex === -1) continue;

        const dateColumnIndex = findDateColumnIndex(
          rows,
          headerRowIndex
        );

        if (
          dateColumnIndex === -1 ||
          dateColumnIndex === medianColumnIndex
        ) {
          continue;
        }

        const points: RawPoint[] = [];

        for (
          let rowIndex = headerRowIndex + 1;
          rowIndex < rows.length;
          rowIndex++
        ) {
          const row = rows[rowIndex];

          if (!row) continue;

          const date = normalizeSceDate(
            row[dateColumnIndex]
          );

          /*
           * Once actual data has started, the first non-date row means
           * this table/section has ended. This prevents values from the
           * next Household Finance chart from leaking into this series.
           */
          if (!date) {
            if (points.length) break;
            continue;
          }

          const value = normalizeNumber(
            row[medianColumnIndex]
          );

          if (
            value === null ||
            isSceDateValue(row[medianColumnIndex])
          ) {
            continue;
          }

          // Household Finance expectations are percentages.
          if (value < -20 || value > 20) continue;

          points.push({
            date,
            value,
          });
        }

        const cleaned = dedupeAndSort(points);

        // A valid monthly SCE series should contain many observations.
        if (cleaned.length > 1) {
          return cleaned;
        }
      }
    }
  }

  return [];
}

/**
 * Public adapter used by ingest.ts.
 */
const SCE_PAGE_URL = "https://www.newyorkfed.org/microeconomics/sce";

async function fetchLatestSceReleasePoints(
  seriesId: "SCE_LABOR_EARNINGS_1Y" | "SCE_LABOR_JOB_FINDING_1Y"
): Promise<RawPoint[]> {
  const indexRes = await fetch(SCE_PAGE_URL, {
    headers: { Accept: "text/html", "User-Agent": "MacroHub/1.0" },
    cache: "no-store",
  });
  if (!indexRes.ok) throw new Error(`NY Fed SCE page ${indexRes.status}`);

  const indexHtml = await indexRes.text();
  const releaseHref = indexHtml.match(
    /href=["'](https?:\/\/www\.newyorkfed\.org)?(\/newsevents\/news\/research\/20\d{2}\/20\d{6})["']/i
  );
  const releaseUrl = releaseHref
    ? `https://www.newyorkfed.org${releaseHref[2]}`
    : null;
  if (!releaseUrl) throw new Error("NY Fed current SCE release link not found");

  const releaseRes = await fetch(releaseUrl, {
    headers: { Accept: "text/html", "User-Agent": "MacroHub/1.0" },
    cache: "no-store",
  });
  if (!releaseRes.ok) throw new Error(`NY Fed SCE release ${releaseRes.status}`);

  const html = await releaseRes.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&rsquo;|&#8217;/gi, "’")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  const periodMatch = text.match(/released the ([A-Za-z]+) (20\d{2}) Survey of Consumer Expectations/i);
  if (!periodMatch) throw new Error("NY Fed SCE release month not found");

  const monthMap: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  const month = monthMap[periodMatch[1]!.toLowerCase()];
  if (!month) throw new Error("NY Fed SCE release month is invalid");
  const date = `${periodMatch[2]}-${month}-01`;

  let value: number | null = null;

  if (seriesId === "SCE_LABOR_EARNINGS_1Y") {
    const m = text.match(/Median one-year-ahead earnings growth expectations[^%]{0,220}?(?:to|at)\s*([0-9]+(?:\.[0-9]+)?)%/i);
    value = m ? Number(m[1]) : null;
  } else {
    const m = text.match(/mean perceived probability of finding a job if one[’']s current job was lost[^%]{0,220}?(?:to|at)\s*([0-9]+(?:\.[0-9]+)?)%/i);
    value = m ? Number(m[1]) : null;
  }

  if (value === null || !Number.isFinite(value)) {
    throw new Error(`NY Fed SCE release does not contain ${seriesId}`);
  }

  return [{ date, value }];
}

async function fetchNyfedInflationUncertainty1y(): Promise<RawPoint[]> {
  const workbook = await fetchWorkbookForSeries(
    SCE_DATA_URL,
    "SCE_INFLATION_UNCERTAINTY_1Y"
  );

  const aliases = [
    "median inflation uncertainty one year",
    "median inflation uncertainty 1 year",
    "inflation uncertainty one year",
    "inflation uncertainty 1 year",
  ];

  const points = extractSeriesByAliasesFromWorkbook(workbook, aliases);
  if (!points.length) {
    throw new Error(
      "NY Fed SCE one-year inflation uncertainty column not found in official workbook"
    );
  }
  return points;
}

export async function fetchNyfedSeries(
  seriesId: NyfedSeriesId
): Promise<RawPoint[]> {
  switch (seriesId) {
    case "SCE_INFLATION_1Y":
      return (
        await fetchNyFedSceInflationExpectations()
      ).oneYear;

    case "SCE_INFLATION_3Y":
      return (
        await fetchNyFedSceInflationExpectations()
      ).threeYear;

    case "SCE_INFLATION_5Y":
      return (
        await fetchNyFedSceInflationExpectations()
      ).fiveYear;

    case "SCE_INFLATION_UNCERTAINTY_1Y":
      return fetchNyfedInflationUncertainty1y();

    default: {
      const config = NYFED_OFFICIAL_SERIES[seriesId];

      if (!config) {
        throw new Error(
          `Unsupported NY Fed SCE series: ${seriesId}`
        );
      }

      const workbookUrl = SCE_DATA_URL;

      const workbook = await fetchWorkbookForSeries(workbookUrl, seriesId);
      const isHouseholdFinance =
        seriesId === "SCE_FINANCE_INCOME_1Y" ||
        seriesId === "SCE_FINANCE_SPENDING_1Y" ||
        seriesId === "SCE_FINANCE_TAX_1Y";

      const points = isHouseholdFinance
        ? extractHouseholdFinanceSeries(workbook, seriesId)
        : seriesId === "SCE_LABOR_EARNINGS_1Y"
          ? extractEarningsGrowthSeriesFromWorkbook(workbook)
          : extractSeriesByAliasesFromWorkbook(
              workbook,
              config.aliases
            );

      if (points.length) return points;

      if (
        seriesId === "SCE_LABOR_EARNINGS_1Y" ||
        seriesId === "SCE_LABOR_JOB_FINDING_1Y"
      ) {
        const releasePoint = await fetchLatestSceReleasePoints(seriesId);
        if (releasePoint.length) {
          console.warn(`[nyfed] ${seriesId}: workbook series not found; using current official SCE release point`);
          return releasePoint;
        }
      }

      throw new Error(
        `${config.label} series is empty in the official NY Fed SCE workbook`
      );
    }
  }
}
