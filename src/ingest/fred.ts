import type { RawPoint } from "./transforms";

const FRED_OBS = "https://api.stlouisfed.org/fred/series/observations";
const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export interface FredFetchResult {
  seriesId: string;
  points: RawPoint[];
  via: "api" | "csv";
}

/**
 * Fetch full history for a FRED series.
 * Prefers API key when present; falls back to public CSV (no key required).
 */
export async function fetchFredSeries(
  seriesId: string,
  opts?: { observationStart?: string }
): Promise<FredFetchResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey) {
    try {
      return await fetchViaApi(seriesId, apiKey, opts?.observationStart);
    } catch (err) {
      console.warn(`[fred] API failed for ${seriesId}, falling back to CSV:`, err);
    }
  }
  return fetchViaCsv(seriesId);
}

async function fetchViaApi(
  seriesId: string,
  apiKey: string,
  observationStart?: string
): Promise<FredFetchResult> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: observationStart ?? "1776-07-04",
    sort_order: "asc",
  });
  const res = await fetch(`${FRED_OBS}?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`FRED API ${res.status} for ${seriesId}`);
  const json = (await res.json()) as {
    observations: Array<{ date: string; value: string }>;
  };
  const points: RawPoint[] = [];
  for (const o of json.observations ?? []) {
    if (o.value === "." || o.value === "") continue;
    const value = Number(o.value);
    if (!Number.isFinite(value)) continue;
    points.push({ date: o.date, value });
  }
  return { seriesId, points, via: "api" };
}

async function fetchViaCsv(seriesId: string): Promise<FredFetchResult> {
  const url = `${FRED_CSV}?id=${encodeURIComponent(seriesId)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "macro-economy-tracker/1.0" },
  });
  if (!res.ok) throw new Error(`FRED CSV ${res.status} for ${seriesId}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const points: RawPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    const raw = line.slice(comma + 1).trim();
    if (!date || raw === "." || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    // Normalize to YYYY-MM-DD
    const norm = normalizeDate(date);
    if (!norm) continue;
    points.push({ date: norm, value });
  }
  if (points.length === 0) {
    throw new Error(`FRED CSV empty for ${seriesId}`);
  }
  return { seriesId, points, via: "csv" };
}

function normalizeDate(d: string): string | null {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // M/D/YYYY
  const mdy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  const parsed = Date.parse(d);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** Simple concurrency pool */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
