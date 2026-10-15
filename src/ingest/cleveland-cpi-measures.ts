import * as cheerio from "cheerio";
import type { RawPoint } from "./transforms";
import { isFreshReleaseFetch } from "./release-fetch-context.js";

const PAGE = "https://www.clevelandfed.org/indicators-and-data/median-cpi";
const DOWNLOADS: Record<string, RegExp> = {
  "us-cleveland-median-cpi": /mcpi_revised\.csv/i,
  "us-cleveland-trimmed-cpi": /trim_revised\.csv/i,
  "us-cleveland-median-cpi-mom": /mcpi_revised\.csv/i,
  "us-cleveland-trimmed-cpi-mom": /trim_revised\.csv/i,
};
const CACHE_MS = 15_000;
const cached = new Map<string, { fetchedAt: number; points: RawPoint[] }>();
const requests = new Map<string, Promise<RawPoint[]>>();

export function parseClevelandCpiCsv(csv: string, metricId: string): RawPoint[] {
  if (!DOWNLOADS[metricId]) throw new Error(`Unsupported Cleveland Fed CPI metric ${metricId}`);
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  const rows = lines.map(parseCsvLine);
  const isMom = metricId.endsWith("-mom");
  const isOfficialMonthlyChange = (value: string) => /(?:^|_)monthly_chg$/i.test(value.trim()) && !/(?:ann|annual)/i.test(value);
  const isAnnualizedMonthlyChange = (value: string) => /(?:^|_)ann?_?monthly_chg$/i.test(value.trim()) || /annualized.*month/i.test(value);
  const isDirectYoY = (value: string) => /12\s*[- ]?month|past\s+12|year.?over.?year|\byoy\b/i.test(value) && !isAnnualizedMonthlyChange(value);
  const isDirectMoM = (value: string) => /^(?:1\s*[- ]?month|monthly|month.?to.?month)$/i.test(value.trim());
  const headerIndex = rows.findIndex(row => row.some(value => /date|month/i.test(value)) && row.some(value => isOfficialMonthlyChange(value) || isDirectMoM(value) || isDirectYoY(value)));
  if (headerIndex < 0) throw new Error(`Cleveland Fed CPI CSV is missing its date or ${isMom ? "1-month" : "12-month"} column`);
  const header = rows[headerIndex]!;
  const dateColumn = header.findIndex(value => /date|month/i.test(value));
  const monthlyColumn = header.findIndex(value => isOfficialMonthlyChange(value) || isDirectMoM(value));
  const monthlyIsFraction = monthlyColumn >= 0 && isOfficialMonthlyChange(header[monthlyColumn]!);
  const yoyColumn = header.findIndex(isDirectYoY);
  if (dateColumn < 0 || (isMom ? monthlyColumn < 0 : yoyColumn < 0 && monthlyColumn < 0)) throw new Error(`Cleveland Fed CPI CSV is missing its date or ${isMom ? "1-month" : "12-month"} column`);
  const monthlyPoints = rows.slice(headerIndex + 1).flatMap(row => {
    const date = normalizeDate(row[dateColumn] ?? "");
    const raw = Number(String(row[monthlyColumn] ?? "").replace(/[%,$]/g, "").trim());
    const value = monthlyIsFraction ? raw * 100 : raw;
    return date && row[monthlyColumn]?.trim() && Number.isFinite(value) ? [{ date, value }] : [];
  }).sort((a,b) => a.date.localeCompare(b.date));
  if (isMom) {
    if (!monthlyPoints.length) throw new Error("Cleveland Fed CPI CSV contains no valid 1-month observations");
    return monthlyPoints;
  }
  let points: RawPoint[];
  if (yoyColumn >= 0) {
    points = rows.slice(headerIndex + 1).flatMap(row => {
      const date = normalizeDate(row[dateColumn] ?? "");
      const value = Number(String(row[yoyColumn] ?? "").replace(/[%,$]/g, "").trim());
      return date && row[yoyColumn]?.trim() && Number.isFinite(value) ? [{ date, value }] : [];
    }).sort((a,b) => a.date.localeCompare(b.date));
  } else {
    points = monthlyPoints.flatMap((point, index) => {
      if (index < 11) return [];
      const window = monthlyPoints.slice(index - 11, index + 1);
      if (window.length !== 12) return [];
      for (let i = 1; i < window.length; i++) {
        const previous = new Date(`${window[i - 1]!.date}T00:00:00Z`);
        previous.setUTCMonth(previous.getUTCMonth() + 1);
        if (previous.toISOString().slice(0, 10) !== window[i]!.date) return [];
      }
      const factor = window.reduce((product, item) => product * (1 + item.value / 100), 1);
      return [{ date: point.date, value: (factor - 1) * 100 }];
    });
  }
  if (!points.length) throw new Error(`Cleveland Fed CPI CSV contains no valid ${isMom ? "1-month" : "12-month"} observations`);
  return points;
}

export async function fetchClevelandCpiMeasure(metricId: string): Promise<RawPoint[]> {
  const filename = DOWNLOADS[metricId];
  if (!filename) throw new Error(`Unsupported Cleveland Fed CPI metric ${metricId}`);
  const memo = cached.get(metricId);
  if (!isFreshReleaseFetch() && memo && Date.now() - memo.fetchedAt < CACHE_MS) return memo.points;
  const pending = requests.get(metricId);
  if (pending) return pending;
  const request = fetchPublishedSeries(metricId, filename);
  requests.set(metricId, request);
  try {
    const points = await request;
    cached.set(metricId, { fetchedAt: Date.now(), points });
    return points;
  } finally {
    requests.delete(metricId);
  }
}

async function fetchPublishedSeries(metricId: string, filename: RegExp): Promise<RawPoint[]> {
  const pageResponse = await fetch(PAGE, { cache: "no-store", headers: { Accept: "text/html", "User-Agent": "MacroHub/1.0" } });
  if (!pageResponse.ok) throw new Error(`Cleveland Fed Median CPI page HTTP ${pageResponse.status}`);
  const $ = cheerio.load(await pageResponse.text());
  const href = $("a[href]").toArray().map(el => $(el).attr("href") ?? "").find(value => filename.test(value));
  if (!href) throw new Error(`Cleveland Fed official download link not found for ${metricId}`);
  const response = await fetch(new URL(href, PAGE), { cache: "no-store", headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": "MacroHub/1.0" } });
  if (!response.ok) throw new Error(`Cleveland Fed CPI CSV HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!/csv|text|octet-stream/i.test(contentType) && !/date/i.test(body.slice(0, 300))) throw new Error("Cleveland Fed CPI response is not a CSV download");
  return parseClevelandCpiCsv(body, metricId);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "", quoted = false;
  for (let i=0; i<line.length; i++) {
    const char = line[i]!;
    if (char === '"' && quoted && line[i+1] === '"') { current += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizeDate(value: string): string | null {
  const text = value.trim();
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${String(Number(us[1])).padStart(2,"0")}-01`;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2,"0")}-01`;
  const month = text.match(/^([A-Za-z]{3,9})[- /](\d{2,4})$/);
  if (month) {
    let year = Number(month[2]); if (year < 100) year += year > 50 ? 1900 : 2000;
    const date = new Date(`${month[1]} 1, ${year} UTC`);
    if (Number.isFinite(date.getTime())) return `${year}-${String(date.getUTCMonth()+1).padStart(2,"0")}-01`;
  }
  return null;
}
