

import type { RawPoint } from "./transforms";
import { inflateRawSync } from "node:zlib";
const SAFE_ZIP =
  "https://www.ecb.europa.eu/stats/pdf/surveys/sme/SAFE_main_series.zip";

/**
 * SAFE Chart 14 contains firms' expectations for:
 *
 * 1. Selling prices
 * 2. Wage costs
 * 3. Non-labour input costs
 * 4. Employment
 *
 * We only expose the first three because they are the
 * inflation-expectation components used by the dashboard.
 *
 * Source:
 * ECB Survey on the Access to Finance of Enterprises (SAFE)
 * Question 34 / Chart 14.
 */


/* ============================================================
 * PUBLIC FETCHERS
 * ============================================================
 */

/**
 * Firms' expected selling-price growth over the next 12 months.
 *
 * Unit: %
 */
export async function fetchEcbSafeSellingPriceExpectations(): Promise<
  RawPoint[]
> {
  const buf = await downloadSafeWorkbook();

  return parseSafeChart14(buf, "sellingPrice");
}


/**
 * Firms' expected wage-cost growth over the next 12 months.
 *
 * Unit: %
 */
export async function fetchEcbSafeWageExpectations(): Promise<
  RawPoint[]
> {
  const buf = await downloadSafeWorkbook();

  return parseSafeChart14(buf, "wage");
}


/**
 * Firms' expected non-labour input-cost growth over the next
 * 12 months.
 *
 * Unit: %
 */
export async function fetchEcbSafeInputCostExpectations(): Promise<
  RawPoint[]
> {
  const buf = await downloadSafeWorkbook();

  return parseSafeChart14(buf, "inputCost");
}


/**
 * Backwards-compatible alias.
 *
 * Your existing pipeline already calls this function, so we
 * keep the old export name.
 */
export async function fetchEcbSafeWageExpectationsLegacy(): Promise<
  RawPoint[]
> {
  return fetchEcbSafeWageExpectations();
}


/* ============================================================
 * DOWNLOAD ECB SAFE WORKBOOK
 * ============================================================
 */

async function downloadSafeWorkbook(): Promise<Buffer> {
  const res = await fetch(SAFE_ZIP, {
    headers: {
      "User-Agent": "macro-economy-tracker/1.0",
      Accept: "*/*",
    },
  });

  if (!res.ok) {
    throw new Error(
      `ECB SAFE zip ${res.status} ${res.statusText}`
    );
  }

  return Buffer.from(await res.arrayBuffer());
}


/* ============================================================
 * ZIP / XLSX EXTRACTION
 * ============================================================
 */

function parseSafeChart14(
  zipBuf: Buffer,
  metric:
    | "sellingPrice"
    | "wage"
    | "inputCost"
): RawPoint[] {
  const xlsxName = listZipEntries(zipBuf).find((name) =>
    name.toLowerCase().endsWith(".xlsx")
  );

  if (!xlsxName) {
    throw new Error("ECB SAFE zip missing XLSX workbook");
  }

  const xlsxBuf = readZipEntryBuffer(zipBuf, xlsxName);
  const sharedXml = readZipEntryText(xlsxBuf, "xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sharedXml);

  // Chart 14 is the worksheet containing the exact title below.
  // In the current ECB SAFE workbook it is sheet16, but locate it by
  // title so worksheet numbering changes do not break ingestion.
  const sheetNames = listZipEntries(xlsxBuf)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));

  let chart14Rows: ParsedRow[] | null = null;

  for (const sheetName of sheetNames) {
    let sheetXml: string;
    try {
      sheetXml = readZipEntryText(xlsxBuf, sheetName);
    } catch {
      continue;
    }

    const rows = parseWorksheetRows(sheetXml, sharedStrings);
    const title = rows
      .slice(0, 15)
      .flatMap((row) => [...row.cells.values()])
      .join(" ")
      .toLowerCase();

    if (
      title.includes(
        "chart 14. expectations for selling prices, wages, input costs and employees one year ahead"
      )
    ) {
      chart14Rows = rows;
      break;
    }
  }

  if (!chart14Rows) {
    throw new Error("ECB SAFE Chart 14 worksheet could not be located");
  }

  return parseChart14(chart14Rows, sharedStrings, metric);
}

/* ============================================================
 * CHART 14 PARSER
 * ============================================================
 */

function parseChart14(
  rows: ParsedRow[],
  _shared: string[],
  metric:
    | "sellingPrice"
    | "wage"
    | "inputCost"
): RawPoint[] {
  if (!rows.length) {
    throw new Error("ECB SAFE Chart 14 contains no rows");
  }

  // VERIFIED from SAFE_series_2026Q2.xlsx Chart 14:
  // B = observation date, E = selling-price mean,
  // K = wage-cost mean, Q = non-labour-input-cost mean.
  const valueColumn =
    metric === "sellingPrice"
      ? 4  // Excel E
      : metric === "wage"
        ? 10 // Excel K
        : 16; // Excel Q

  const points = parseRowsUsingColumn(rows, valueColumn)
    .filter((point) => Math.abs(point.value) > 1e-9);

  if (!points.length) {
    throw new Error(
      `ECB SAFE Chart 14: no observations found for ${metric} in verified column ${valueColumn}`
    );
  }

  return points;
}


interface ParsedRow {
  rowNumber: number;
  cells: Map<number, string>;
}


function parseWorksheetRows(
  xml: string,
  shared: string[]
): ParsedRow[] {
  const rows: ParsedRow[] = [];

  const rowRe =
    /<row\b[^>]*>([\s\S]*?)<\/row>/g;

  let match: RegExpExecArray | null;

  while (
    (match = rowRe.exec(xml)) !== null
  ) {
    const rowXml = match[1] ?? "";

    const rowNumberText =
      /<row\b[^>]*\br="(\d+)"/.exec(
        match[0]
      )?.[1];

    const rowNumber =
      rowNumberText
        ? Number(rowNumberText)
        : rows.length + 1;

    const cells =
      parseRowCellMap(
        rowXml,
        shared
      );

    if (!cells.size) {
      continue;
    }

    rows.push({
      rowNumber,
      cells,
    });
  }

  return rows;
}


/**
 * Parse cells while preserving their actual Excel column.
 *
 * This is better than simply returning an array because
 * blank cells in Excel otherwise shift all subsequent
 * columns.
 */
function parseRowCellMap(
  rowXml: string,
  shared: string[]
): Map<number, string> {
  const cells =
    new Map<number, string>();

  const cellRe =
    /<c\b[^>]*\br="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g;

  let match: RegExpExecArray | null;

  while (
    (match = cellRe.exec(rowXml)) !== null
  ) {
    const columnLetters =
      match[1] ?? "";

    const attrs =
      match[3] ?? "";

    const inner =
      match[4] ?? "";

    const column =
      colLettersToIndex(
        columnLetters
      );

    const type =
      /(?:^|\s)t="([^"]+)"/.exec(
        attrs
      )?.[1];

    const value =
      /<v>([\s\S]*?)<\/v>/.exec(
        inner
      )?.[1] ?? "";

    let parsedValue =
      decodeXmlEntities(value);

    /*
     * Shared string.
     */
    if (
      type === "s" &&
      parsedValue !== ""
    ) {
      const index =
        Number(parsedValue);

      if (Number.isFinite(index)) {
        parsedValue =
          shared[index] ?? "";
      }
    }

    /*
     * Inline string.
     */
    if (type === "inlineStr") {
      const text =
        inner.match(
          /<t[^>]*>([\s\S]*?)<\/t>/
        )?.[1];

      if (text !== undefined) {
        parsedValue =
          decodeXmlEntities(text);
      }
    }

    cells.set(
      column,
      parsedValue
    );
  }

  return cells;
}


/* ============================================================
 * EXTRACT OBSERVATIONS
 * ============================================================
 */

function findSafeRowDate(row: ParsedRow): string | null {
  const first = row.cells.get(0);
  const serial = Number(first);

  if (Number.isFinite(serial) && serial >= 40000) {
    return excelSerialToMonth(serial);
  }

  for (const column of [0, 1, 2, 3, 4]) {
    const value = row.cells.get(column)?.trim();
    if (!value) continue;

    const match =
      /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(value);

    if (match) {
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) {
        return `${match[1]}-${String(month).padStart(2, "0")}-01`;
      }
    }
  }

  return null;
}


function parseRowsUsingColumn(
  rows: ParsedRow[],
  valueColumn: number
): RawPoint[] {
  const points: RawPoint[] = [];

  for (const row of rows) {
    /*
     * SAFE workbooks normally store the period as an Excel serial in
     * the first column, but tolerate a textual YYYY-MM/date value too.
     */
    const date = findSafeRowDate(row);

    if (!date) {
      continue;
    }

    const rawValue =
      row.cells.get(valueColumn);

    const value =
      Number(rawValue);

    if (!Number.isFinite(value)) {
      continue;
    }

    points.push({
      date,
      value:
        Math.round(value * 1000) / 1000,
    });
  }

  /*
   * Remove duplicate dates.
   */
  const byDate =
    new Map<string, RawPoint>();

  for (const point of points) {
    byDate.set(
      point.date,
      point
    );
  }

  return [...byDate.values()]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date)
    );
}


/* ============================================================
 * XLSX ZIP HELPERS
 * ============================================================
 */

/**
 * Minimal ZIP reader using Node's built-in zlib.
 *
 * SAFE_main_series.zip is a ZIP containing an XLSX, and XLSX itself is
 * a ZIP. Reading the central directory directly avoids requiring a
 * platform-specific `unzip` binary.
 */
function listZipEntries(zipBuf: Buffer): string[] {
  const eocd = findEndOfCentralDirectory(zipBuf);
  const entryCount = zipBuf.readUInt16LE(eocd + 10);
  const centralOffset = zipBuf.readUInt32LE(eocd + 16);

  const names: string[] = [];
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (zipBuf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ECB SAFE ZIP central directory is invalid");
    }

    const fileNameLength = zipBuf.readUInt16LE(offset + 28);
    const extraLength = zipBuf.readUInt16LE(offset + 30);
    const commentLength = zipBuf.readUInt16LE(offset + 32);

    const name = zipBuf
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    names.push(name);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return names;
}

function readZipEntryText(
  zipBuf: Buffer,
  entry: string
): string {
  return readZipEntryBuffer(zipBuf, entry).toString("utf8");
}

function readZipEntryBuffer(
  zipBuf: Buffer,
  entry: string
): Buffer {
  const eocd = findEndOfCentralDirectory(zipBuf);
  const entryCount = zipBuf.readUInt16LE(eocd + 10);
  const centralOffset = zipBuf.readUInt32LE(eocd + 16);

  let offset = centralOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (zipBuf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ECB SAFE ZIP central directory is invalid");
    }

    const compressionMethod = zipBuf.readUInt16LE(offset + 10);
    const compressedSize = zipBuf.readUInt32LE(offset + 20);
    const fileNameLength = zipBuf.readUInt16LE(offset + 28);
    const extraLength = zipBuf.readUInt16LE(offset + 30);
    const commentLength = zipBuf.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(offset + 42);

    const name = zipBuf
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    if (name === entry) {
      if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error(
          `ECB SAFE ZIP local header is invalid for ${entry}`
        );
      }

      const localNameLength =
        zipBuf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength =
        zipBuf.readUInt16LE(localHeaderOffset + 28);

      const dataStart =
        localHeaderOffset +
        30 +
        localNameLength +
        localExtraLength;

      const compressed = zipBuf.subarray(
        dataStart,
        dataStart + compressedSize
      );

      if (compressionMethod === 0) {
        return Buffer.from(compressed);
      }

      if (compressionMethod === 8) {
        return inflateRawSync(compressed);
      }

      throw new Error(
        `ECB SAFE ZIP uses unsupported compression method ${compressionMethod} for ${entry}`
      );
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`ECB SAFE ZIP entry not found: ${entry}`);
}

function findEndOfCentralDirectory(zipBuf: Buffer): number {
  // EOCD can be followed by a max 65,535-byte comment.
  const minimum = Math.max(0, zipBuf.length - 65_557);

  for (let i = zipBuf.length - 22; i >= minimum; i -= 1) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }

  throw new Error("ECB SAFE ZIP end-of-central-directory record not found");
}


/**
 * Read Excel shared strings.
 */
function parseSharedStrings(
  xml: string
): string[] {
  const out: string[] = [];

  const siRe =
    /<si>([\s\S]*?)<\/si>/g;

  let match: RegExpExecArray | null;

  while (
    (match = siRe.exec(xml)) !== null
  ) {
    const chunk =
      match[1] ?? "";

    const texts = [
      ...chunk.matchAll(
        /<t[^>]*>([\s\S]*?)<\/t>/g
      ),
    ].map(
      (item) =>
        decodeXmlEntities(
          item[1] ?? ""
        )
    );

    out.push(
      texts.join("")
    );
  }

  return out;
}


/* ============================================================
 * EXCEL COLUMN HELPERS
 * ============================================================
 */

function colLettersToIndex(
  letters: string
): number {
  let n = 0;

  for (const ch of letters) {
    n =
      n * 26 +
      (ch.charCodeAt(0) - 64);
  }

  return n - 1;
}


/* ============================================================
 * EXCEL DATE
 * ============================================================
 */

function excelSerialToMonth(
  serial: number
): string | null {
  /*
   * Excel's serial date system.
   *
   * 25569 = 1970-01-01 in Excel's
   * 1900 date system.
   */
  const ms =
    Math.round(
      (serial - 25569) *
        86400 *
        1000
    );

  const date =
    new Date(ms);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return (
    `${date.getUTCFullYear()}-` +
    `${String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")}-01`
  );
}


/* ============================================================
 * XML ENTITY DECODER
 * ============================================================
 */

function decodeXmlEntities(
  value: string
): string {
  return value
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /&lt;/g,
      "<"
    )
    .replace(
      /&gt;/g,
      ">"
    )
    .replace(
      /&quot;/g,
      '"'
    )
    .replace(
      /&apos;/g,
      "'"
    )
    .replace(
      /&#(\d+);/g,
      (_, code: string) =>
        String.fromCharCode(
          Number(code)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, code: string) =>
        String.fromCharCode(
          parseInt(code, 16)
        )
    );
}