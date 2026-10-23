import * as XLSX from "xlsx";
import type { RawPoint } from "./transforms";
import { isFreshReleaseFetch } from "./release-fetch-context.js";

const CLEVELAND_URL = "https://www.clevelandfed.org/-/media/files/webcharts/medianpce/median-pce-full-history.csv";
const DALLAS_URL = "https://www.dallasfed.org/~/media/documents/research/pce/pcehist";
const PAGE_CACHE_MS = 15_000;
const cache = new Map<string, { at: number; points: RawPoint[] }>();
const pending = new Map<string, Promise<RawPoint[]>>();

export function parseMedianPceCsv(csv: string, measure: "yoy" | "mom"): RawPoint[] {
  const rows = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(row => row.trim()).map(parseCsvLine);
  const headerRow = rows.findIndex(row => row.some(cell => /date|month/i.test(cell)) && row.some(cell => /median/i.test(cell)));
  if (headerRow < 0) throw new Error("Cleveland Fed Median PCE download is missing its date/header row");
  const header = rows[headerRow]!;
  const dateCol = header.findIndex(cell => /date|month/i.test(cell));
  const valueCol = header.findIndex(cell => /median/i.test(cell) && (measure === "mom" ? /month|1.?m/i.test(cell) : /12.?month|year|yoy|annual/i.test(cell)));
  if (valueCol < 0) throw new Error(`Cleveland Fed Median PCE download has no ${measure} measure`);
  const points = rows.slice(headerRow + 1).flatMap(row => {
    const date = monthDate(row[dateCol] ?? "");
    const value = numeric(row[valueCol]);
    return date && value !== null ? [{ date, value }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) throw new Error(`Cleveland Fed Median PCE download has no ${measure} observations`);
  return points;
}

export function parseDallasTrimmedMeanWorkbook(data: ArrayBuffer | Uint8Array, measure: "yoy" | "mom"): RawPoint[] {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, raw: false, defval: "" });
    const title = rows.slice(0, 3).flat().map(value => String(value ?? "")).join(" ");
    if (!/trimmed\s*mean\s+pce/i.test(title)) continue;
    const headerRow = rows.findIndex(row => row.some(value => /^1\s*[- ]?month$/i.test(String(value).trim())) && row.some(value => /^12\s*[- ]?month$/i.test(String(value).trim())));
    if (headerRow < 0) continue;
    const header = rows[headerRow]!.map(value => String(value ?? "").trim());
    const rateCol = header.findIndex(value => measure === "mom" ? /^1\s*[- ]?month$/i.test(value) : /^12\s*[- ]?month$/i.test(value));
    if (rateCol < 0) continue;
    const annualRate = /annual\s+rates/i.test(title);
    const points = rows.slice(headerRow + 1).flatMap(row => {
      const date = excelMonthDate(row[0]);
      const raw = numeric(row[rateCol]);
      if (!date || raw === null) return [];
      // Dallas publishes its one-month reading at an annual rate. Convert it
      // to an effective monthly rate for the MoM view.
      const value = measure === "mom" && annualRate ? (Math.pow(1 + raw / 100, 1 / 12) - 1) * 100 : raw;
      return [{ date, value }];
    }).sort((left, right) => left.date.localeCompare(right.date));
    if (points.length) return points;
  }
  throw new Error(`Dallas Fed historical workbook has no Trimmed Mean PCE ${measure} rates`);
}

export function fetchUsUnderlyingPce(metricId: string): Promise<RawPoint[]> {
  const sources: Record<string, { url: string; measure: "yoy" | "mom"; format: "csv" | "xlsx" }> = {
    "us-cleveland-median-pce": { url: CLEVELAND_URL, measure: "yoy", format: "csv" },
    "us-cleveland-median-pce-mom": { url: CLEVELAND_URL, measure: "mom", format: "csv" },
    "us-dallas-trimmed-mean-pce": { url: DALLAS_URL, measure: "yoy", format: "xlsx" },
    "us-dallas-trimmed-mean-pce-mom": { url: DALLAS_URL, measure: "mom", format: "xlsx" },
  };
  const spec = sources[metricId];
  if (!spec) return Promise.reject(new Error(`Unsupported US underlying PCE metric ${metricId}`));
  const key = `${spec.url}:${spec.format}:${spec.measure}`;
  if (!isFreshReleaseFetch()) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return Promise.resolve(cached.points);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const request = fetch(spec.url, { cache: "no-store", headers: { Accept: spec.format === "csv" ? "text/csv,text/plain,*/*" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*", "User-Agent": "MacroHub/1.0" } }).then(async response => {
    if (!response.ok) throw new Error(`Official ${spec.format.toUpperCase()} download HTTP ${response.status} for ${metricId}`);
    const points = spec.format === "csv"
      ? parseMedianPceCsv(await response.text(), spec.measure)
      : parseDallasTrimmedMeanWorkbook(await response.arrayBuffer(), spec.measure);
    cache.set(key, { at: Date.now(), points });
    return points;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let current = "", quoted = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]!; if (c === '"' && quoted && line[i + 1] === '"') { current += '"'; i++; } else if (c === '"') quoted = !quoted; else if (c === "," && !quoted) { out.push(current.trim()); current = ""; } else current += c; }
  out.push(current.trim()); return out;
}
function numeric(value: unknown): number | null { const n = Number(String(value ?? "").replace(/[%,\s$]/g, "")); return value !== "" && value !== null && Number.isFinite(n) ? n : null; }
function monthDate(value: string): string | null { const s = String(value).trim(); let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[1]!.padStart(2, "0")}-01`; m = s.match(/^(\d{4})[-/](\d{1,2})/); if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-01`; m = s.match(/^([A-Za-z]{3,9})[- /](\d{2,4})$/); if (m) { let y = Number(m[2]); if (y < 100) y += y > 50 ? 1900 : 2000; const d = new Date(`${m[1]} 1, ${y} UTC`); return Number.isFinite(d.getTime()) ? `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01` : null; } return null; }
function excelMonthDate(value: unknown): string | null { if (value instanceof Date && Number.isFinite(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`; if (typeof value === "number") { const d = XLSX.SSF.parse_date_code(value); return d ? `${d.y}-${String(d.m).padStart(2, "0")}-01` : null; } return monthDate(String(value ?? "")); }
