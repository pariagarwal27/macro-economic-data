import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
import type { RawPoint } from "./transforms";
import { isFreshReleaseFetch } from "./release-fetch-context.js";

const PAGE = "https://www.atlantafed.org/research-and-data/data/sticky-price-cpi";
const BASE_IDS = ["us-sticky-cpi", "us-core-sticky-cpi", "us-flexible-cpi"] as const;
const IDS = [...BASE_IDS, ...BASE_IDS.map(id => `${id}-mom`)] as const;
const LABELS: Record<(typeof IDS)[number], RegExp> = {
  "us-sticky-cpi": /sticky(?:-price)?\s+cpi.*12.?month|sticky\s+12.?month/i,
  "us-core-sticky-cpi": /core\s+sticky\s+cpi.*12.?month|coresticky.*12.?month/i,
  "us-flexible-cpi": /flexible\s+cpi.*12.?month|flexible.*12.?month/i,
};
const WORKBOOK_GROUPS: Record<(typeof BASE_IDS)[number], RegExp> = {
  "us-sticky-cpi": /^sticky\s+cpi\s*\(monthly\)$/i,
  "us-core-sticky-cpi": /^core\s+sticky\s+cpi\s*\(monthly\)$/i,
  "us-flexible-cpi": /^flexible\s+cpi\s*\(monthly\)$/i,
};

type Parsed = Record<string, RawPoint[]>;
let cachedDataset: { fetchedAt: number; points: Parsed } | null = null;
let datasetRequest: Promise<Parsed> | null = null;

export function parseAtlantaStickyWorkbook(bytes: Buffer | Uint8Array): Parsed {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(Buffer.from(bytes), { type: "buffer", cellDates: true }); }
  catch { throw new Error("Atlanta Fed sticky CPI download is not a readable workbook"); }
  const found: Partial<Record<(typeof IDS)[number], RawPoint[]>> = {};
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, raw: true, defval: null });
    for (let headerIndex = 0; headerIndex < Math.min(rows.length, 40); headerIndex++) {
      const header = rows[headerIndex] ?? [];
      const dateColumn = header.findIndex(value => /^(date|dates|month|period|observation date)$/i.test(String(value ?? "").trim()));
      if (dateColumn < 0) continue;
      const columns = new Map<(typeof IDS)[number], number>();
      for (const id of BASE_IDS) {
        const matcher = LABELS[id];
        const momLabelMatcher = id === "us-sticky-cpi" ? /sticky(?:-price)?\s+cpi/i
          : id === "us-core-sticky-cpi" ? /core\s+sticky\s+cpi|coresticky/i
            : /flexible\s+cpi/i;
        // Current official workbook format groups each measure into four columns:
        // index, one-month annualized change, three-month annualized change, 12mo.
        const groupColumn = header.findIndex(value => WORKBOOK_GROUPS[id].test(String(value ?? "").trim()));
        const hasGroupedAnnual = groupColumn >= 0 && /^(?:12\s*mo|12\s*[- ]?month)$/i.test(String(header[groupColumn + 3] ?? "").trim());
        const hasGroupedMom = groupColumn >= 0 && /1\s*[- ]?mo\s+annualized/i.test(String(header[groupColumn + 1] ?? "").trim());
        const annualColumn = hasGroupedAnnual
          ? groupColumn + 3
          : header.findIndex(value => matcher.test(String(value ?? "")) && !/1.?month|3.?month/i.test(String(value ?? "")));
        const momColumn = hasGroupedMom
          ? groupColumn + 1
          : header.findIndex(value => {
            const label = String(value ?? "");
            return momLabelMatcher.test(label) && /1.?month/i.test(label);
          });
        if (annualColumn >= 0) columns.set(id, annualColumn);
        if (momColumn >= 0) columns.set(`${id}-mom` as (typeof IDS)[number], momColumn);
      }
      for (const [id, column] of columns) {
        const points = rows.slice(headerIndex + 1).flatMap(row => {
          const date = normalizeDate(row[dateColumn]);
          const sourceValue = Number(row[column]);
          const value = id.endsWith("-mom") ? annualizedToMonthlyRate(sourceValue) : sourceValue;
          return date && row[column] != null && Number.isFinite(value) ? [{ date, value }] : [];
        }).sort((a,b) => a.date.localeCompare(b.date));
        if (points.length) found[id] = points;
      }
    }
  }
  for (const id of BASE_IDS) if (!found[id]?.length) throw new Error(`Atlanta Fed workbook is missing ${id === "us-sticky-cpi" ? "Sticky CPI" : id === "us-core-sticky-cpi" ? "Core Sticky CPI" : "Flexible CPI"} 12-month history`);
  return found as Parsed;
}

// Atlanta's 1-month CPI series is reported at an annualized rate. Convert it
// back to the equivalent one-month rate so the dashboard's MoM view is on the
// same basis as the CPI/Cleveland monthly readings.
function annualizedToMonthlyRate(value: number): number {
  return (Math.pow(1 + value / 100, 1 / 12) - 1) * 100;
}

export async function fetchAtlantaStickyCpi(id: string): Promise<RawPoint[]> {
  if (!IDS.includes(id as (typeof IDS)[number])) throw new Error(`Unsupported Atlanta Fed sticky CPI metric ${id}`);
  const points = await fetchDataset();
  const series = points[id as (typeof IDS)[number]];
  if (!series?.length) throw new Error(`Atlanta Fed workbook is missing the requested series ${id}`);
  return series;
}

async function fetchDataset(): Promise<Parsed> {
  if (!isFreshReleaseFetch() && cachedDataset && Date.now() - cachedDataset.fetchedAt < 15_000) return cachedDataset.points;
  if (datasetRequest) return datasetRequest;
  datasetRequest = (async () => {
  const pageResponse = await fetch(PAGE, { cache: "no-store", headers: { Accept: "text/html", "User-Agent": "MacroHub/1.0" } });
  if (!pageResponse.ok) throw new Error(`Atlanta Fed sticky CPI page HTTP ${pageResponse.status}`);
  const $ = cheerio.load(await pageResponse.text());
  const href = $("a[href]").toArray().map(el => $(el).attr("href") ?? "").find(value => /stickprice\/stickyprice\.xlsx/i.test(value));
  if (!href) throw new Error("Atlanta Fed official sticky CPI workbook link not found");
  const response = await fetch(new URL(href, PAGE), { cache: "no-store", headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*", "User-Agent": "MacroHub/1.0" } });
  if (!response.ok) throw new Error(`Atlanta Fed sticky CPI workbook HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Atlanta Fed sticky CPI response is not an XLSX workbook");
  const points = parseAtlantaStickyWorkbook(bytes);
  cachedDataset = { fetchedAt: Date.now(), points };
  return points;
  })();
  try { return await datasetRequest; }
  finally { datasetRequest = null; }
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,"0")}-01`;
  if (typeof value === "number" && Number.isFinite(value)) { const date = new Date(Date.UTC(1899,11,30) + Math.floor(value)*86_400_000); return normalizeDate(date); }
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-01`;
  const month = text.match(/^([A-Za-z]{3,9})[- /](\d{4})$/);
  if (month) { const m = new Date(`${month[1]} 1, ${month[2]} UTC`); if (Number.isFinite(m.getTime())) return `${month[2]}-${String(m.getUTCMonth()+1).padStart(2,"0")}-01`; }
  return null;
}
