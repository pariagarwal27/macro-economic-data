import type { RawPoint } from "./transforms";
import { METRICS } from "@/catalog/metrics";
import { LIVE_MAP } from "@/catalog/live-map";
import { getD1Database } from "@/db";
import { getSourceSnapshot } from "./cloud-source-cache";

const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

export interface BlsFetchOptions {
  startYear?: number;
  endYear?: number;
}

/**
 * Official BLS Public Data API — publishes at release time (ahead of FRED).
 * Free key raises limits: https://data.bls.gov/registrationEngine/
 */
export async function fetchBlsSeries(
  seriesIds: string[],
  opts: BlsFetchOptions = {}
): Promise<Map<string, RawPoint[]>> {
  if (!getD1Database()) return fetchBlsSeriesUncached(seriesIds, opts);
  const allIds = [...new Set([...seriesIds, ...METRICS.flatMap(metric => {
    const live = LIVE_MAP[metric.id];
    if (live?.provider === "bls") return [live.seriesId];
    return metric.source === "bls" ? [metric.seriesId] : [];
  })])];
  const snapshot = await getSourceSnapshot(
    `bls:${opts.startYear ?? new Date().getUTCFullYear() - 2}:${opts.endYear ?? new Date().getUTCFullYear()}`,
    10 * 60_000,
    async () => Object.fromEntries(await fetchBlsSeriesUncached(allIds, opts)),
  );
  return new Map(seriesIds.map(id => [id, snapshot[id] ?? []]));
}

async function fetchBlsSeriesUncached(
  seriesIds: string[],
  opts: BlsFetchOptions = {}
): Promise<Map<string, RawPoint[]>> {
  const endYear = opts.endYear ?? new Date().getFullYear();
  const startYear = opts.startYear ?? endYear - 2;
  const registrationkey = process.env.BLS_API_KEY;

  const out = new Map<string, RawPoint[]>();

  // BLS allows 25 (v1) / 50 (v2) series per request.
  for (let i = 0; i < seriesIds.length; i += 25) {
    const chunk = seriesIds.slice(i, i + 25);

    const body: Record<string, unknown> = {
      seriesid: chunk,
      startyear: String(startYear),
      endyear: String(endYear),
    };

    if (registrationkey) {
      body.registrationkey = registrationkey;
    }

    let res: Response | null = null;
    let lastErr = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(BLS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; macro-economy-tracker/1.0; research)",
        },
        body: JSON.stringify(body),
      });

      if (res.ok) break;

      lastErr = `BLS API HTTP ${res.status}`;

      await new Promise((resolve) =>
        setTimeout(resolve, 800 * (attempt + 1))
      );
    }

    if (!res || !res.ok) {
      throw new Error(lastErr || "BLS API failed");
    }

    const json = (await res.json()) as BlsResponse;

    if (json.status !== "REQUEST_SUCCEEDED") {
      const message = json.message?.join("; ") ?? "";

      const quotaExceeded =
        /daily threshold/i.test(message) ||
        /daily.*request.*limit/i.test(message) ||
        /total number of requests allocated/i.test(message);

      if (quotaExceeded) {
        console.warn(
          `[BLS] Daily API request limit reached. ` +
            `Stopping BLS requests for this refresh; ` +
            `keeping any data already fetched.`
        );

        break;
      }

      throw new Error(`BLS API: ${json.status} ${message}`);
    }

    for (const series of json.Results?.series ?? []) {
      out.set(series.seriesID, parseBlsSeries(series));
    }
  }

  return out;
}

export async function fetchBlsSeriesFullHistory(
  seriesIds: string[],
  opts: {
    startYear?: number;
    endYear?: number;
    windowYears?: number;
  } = {}
): Promise<Map<string, RawPoint[]>> {
  const startYear = opts.startYear ?? 1947;
  const endYear = opts.endYear ?? new Date().getFullYear();
  const windowYears = opts.windowYears ?? 10;
  const merged = new Map<string, RawPoint[]>();

  for (let y = startYear; y <= endYear; y += windowYears) {
    const chunk = await fetchBlsSeries(seriesIds, {
      startYear: y,
      endYear: Math.min(y + windowYears - 1, endYear),
    });

    for (const [id, points] of chunk.entries()) {
      merged.set(id, [...(merged.get(id) ?? []), ...points]);
    }
  }

  for (const [id, points] of merged.entries()) {
    const byDate = new Map(points.map((x) => [x.date, x]));

    merged.set(
      id,
      [...byDate.values()].sort((a, b) =>
        a.date.localeCompare(b.date)
      )
    );
  }

  return merged;
}

export async function fetchBlsOne(
  seriesId: string,
  opts?: BlsFetchOptions
): Promise<RawPoint[]> {
  const map = await fetchBlsSeries([seriesId], opts);
  return map.get(seriesId) ?? [];
}

interface BlsResponse {
  status: string;
  message?: string[];
  Results?: {
    series?: Array<{
      seriesID: string;
      data?: Array<{
        year: string;
        period: string;
        value: string;
      }>;
    }>;
  };
}

function parseBlsSeries(series: {
  seriesID: string;
  data?: Array<{
    year: string;
    period: string;
    value: string;
  }>;
}): RawPoint[] {
  const points: RawPoint[] = [];

  for (const row of series.data ?? []) {
    if (!row.value || row.value === "-") continue;

    const value = Number(row.value);

    if (!Number.isFinite(value)) continue;

    const date = blsPeriodToDate(row.year, row.period);

    if (!date) continue;

    points.push({
      date,
      value,
    });
  }

  return points.sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

function blsPeriodToDate(
  year: string,
  period: string
): string | null {
  // M01..M12 monthly, Q01..Q04 quarterly, A01 annual
  const m = period.match(/^M(\d{2})$/);

  if (m) {
    return `${year}-${m[1]}-01`;
  }

  const q = period.match(/^Q0([1-4])$/);

  if (q) {
    const month = String(
      (Number(q[1]) - 1) * 3 + 1
    ).padStart(2, "0");

    return `${year}-${month}-01`;
  }

  if (period === "A01") {
    return `${year}-01-01`;
  }

  // Weekly claims sometimes use different surveys — skip unknown.
  return null;
}
