import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import type { RawPoint } from "./transforms";
import { isFreshReleaseFetch } from "./release-fetch-context.js";

const CLEVELAND_EXPECTATIONS_PAGE =
  "https://www.clevelandfed.org/indicators-and-data/inflation-expectations";
const EXPECTED_INFLATION_SHEET = "Expected Inflation";
let cachedWorkbook: { fetchedAt: number; bytes: Buffer } | null = null;
let workbookRequest: Promise<Buffer> | null = null;

/** Parse the Cleveland Fed's official model-output workbook into a horizon series. */
export function parseClevelandExpectationsWorkbook(
  bytes: Buffer | Uint8Array,
  seriesId: string
): RawPoint[] {
  const horizonMatch = seriesId.match(/^EXPINF(1|2|3|5|10|30)YR$/);
  if (!horizonMatch) {
    throw new Error(`Unsupported Cleveland Fed expectation series ${seriesId}`);
  }

  const horizon = Number(horizonMatch[1]);
  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[EXPECTED_INFLATION_SHEET];
  if (!sheet) {
    throw new Error(
      `Cleveland Fed workbook is missing the ${EXPECTED_INFLATION_SHEET} sheet`
    );
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const header = rows[0] ?? [];
  const dateColumn = header.findIndex((cell) =>
    /^\s*model output date\s*$/i.test(String(cell ?? ""))
  );
  const valueColumn = header.findIndex((cell) => {
    const match = String(cell ?? "").match(/^\s*(\d+)\s*year\s+expected inflation\s*$/i);
    return match != null && Number(match[1]) === horizon;
  });

  if (dateColumn < 0 || valueColumn < 0) {
    throw new Error(`Cleveland Fed workbook does not contain ${horizon}-year expected inflation`);
  }

  const points: RawPoint[] = [];
  for (const row of rows.slice(1)) {
    const date = normalizeModelOutputDate(row[dateColumn]);
    const decimalValue = Number(row[valueColumn]);
    if (!date || row[valueColumn] == null || !Number.isFinite(decimalValue)) continue;
    points.push({ date, value: decimalValue * 100 });
  }

  const sorted = points.sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) {
    throw new Error(`Cleveland Fed workbook has no ${horizon}-year observations`);
  }
  return sorted;
}

/** Fetch the latest historical series directly from Cleveland Fed's published workbook. */
export async function fetchClevelandExpectedInflation(
  seriesId: string
): Promise<RawPoint[]> {
  const bytes = await downloadOfficialWorkbook();
  return parseClevelandExpectationsWorkbook(bytes, seriesId);
}

export async function fetchClevelandExpectedInflationWithFallback(
  seriesId: string,
  options: {
    primaryFetcher?: (id: string) => Promise<RawPoint[]>;
    fallbackFetcher: (id: string) => Promise<RawPoint[]>;
  }
): Promise<{ points: RawPoint[]; note: string }> {
  try {
    const points = await (options.primaryFetcher ?? fetchClevelandExpectedInflation)(seriesId);
    return { points, note: `Live Cleveland Fed model output ${seriesId}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[live] Cleveland Fed workbook failed for ${seriesId}; falling back to FRED: ${message}`);
    const points = await options.fallbackFetcher(seriesId);
    if (!points.length) {
      throw new Error(`Cleveland Fed and FRED returned no observations for ${seriesId}`);
    }
    return {
      points,
      note: `FRED fallback (${seriesId}); Cleveland Fed workbook unavailable`,
    };
  }
}

async function downloadOfficialWorkbook(): Promise<Buffer> {
  if (!isFreshReleaseFetch() && cachedWorkbook && Date.now() - cachedWorkbook.fetchedAt < 10_000) {
    return cachedWorkbook.bytes;
  }
  if (workbookRequest) return workbookRequest;

  workbookRequest = (async () => {
    const pageResponse = await fetch(CLEVELAND_EXPECTATIONS_PAGE, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        "User-Agent": "MacroHub/1.0",
      },
      cache: "no-store",
    });
    if (!pageResponse.ok) {
      throw new Error(`Cleveland Fed expectations page HTTP ${pageResponse.status}`);
    }

    const page = cheerio.load(await pageResponse.text());
    const workbookHref = page("a[href]")
      .toArray()
      .map((element) => ({
        href: page(element).attr("href") ?? "",
        text: page(element).text().replace(/\s+/g, " ").trim(),
      }))
      .find(({ href, text }) =>
        /inflation-expectations\.xlsx(?:[?#]|$)/i.test(href) && /excel/i.test(text)
      )?.href;

    if (!workbookHref) {
      throw new Error("Cleveland Fed expectations workbook link not found on official page");
    }

    const workbookUrl = new URL(workbookHref, CLEVELAND_EXPECTATIONS_PAGE).toString();
    const workbookResponse = await fetch(workbookUrl, {
      headers: {
        Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
        "User-Agent": "MacroHub/1.0",
      },
      cache: "no-store",
    });
    if (!workbookResponse.ok) {
      throw new Error(`Cleveland Fed expectations workbook HTTP ${workbookResponse.status}`);
    }

    const bytes = Buffer.from(await workbookResponse.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error("Cleveland Fed expectations response was not an XLSX workbook");
    }
    cachedWorkbook = { fetchedAt: Date.now(), bytes };
    return bytes;
  })();

  try {
    return await workbookRequest;
  } finally {
    workbookRequest = null;
  }
}

function normalizeModelOutputDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    if (!Number.isFinite(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-01`;
  return null;
}
