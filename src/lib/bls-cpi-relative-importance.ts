import { METRICS } from "@/catalog/metrics";

const BLS_CPI_ASPECTS_URL = "https://download.bls.gov/pub/time.series/cu/cu.aspect";
const CACHE_MS = 12 * 60 * 60 * 1000;
type WeightPoint = { date: string; value: number };
let cached: { expiresAt: number; rows: Map<string, WeightPoint[]> } | null = null;
let pending: Promise<Map<string, WeightPoint[]>> | null = null;

/** Load BLS CPI-U's published monthly relative-importance aspect values. */
async function loadAspectRows(wantedSeries: Set<string>): Promise<Map<string, WeightPoint[]>> {
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch(BLS_CPI_ASPECTS_URL, {
      headers: { "User-Agent": "MacroDashboard CPI data viewer (BLS CPI-U aspects)" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`BLS CPI aspect file returned HTTP ${response.status}`);
    const text = await response.text();
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const header = lines.shift()?.split("\t").map(value => value.trim()) ?? [];
    const index = (name: string) => header.indexOf(name);
    const seriesIndex = index("series_id"), yearIndex = index("year"), periodIndex = index("period"), aspectIndex = index("aspect_type"), valueIndex = index("value");
    if ([seriesIndex, yearIndex, periodIndex, aspectIndex, valueIndex].some(value => value < 0)) throw new Error("BLS CPI aspect file has an unexpected header");
    const result = new Map<string, WeightPoint[]>();
    for (const line of lines) {
      if (!line) continue;
      const cells = line.split("\t");
      if (cells[aspectIndex] !== "I") continue;
      const seriesId = cells[seriesIndex]?.trim();
      if (!seriesId || !wantedSeries.has(seriesId)) continue;
      const year = cells[yearIndex]?.trim();
      const month = cells[periodIndex]?.trim().match(/^M(\d{2})$/)?.[1];
      const value = Number(cells[valueIndex]);
      if (!year || !month || !Number.isFinite(value)) continue;
      const points = result.get(seriesId) ?? [];
      points.push({ date: `${year}-${month}`, value });
      result.set(seriesId, points);
    }
    for (const points of result.values()) points.sort((a, b) => a.date.localeCompare(b.date));
    cached = { expiresAt: Date.now() + CACHE_MS, rows: result };
    return result;
  })().finally(() => { pending = null; });
  return pending;
}

function nsaSeriesId(seriesId: string): string {
  // BLS relative-importance aspects are attached to the CPI-U NSA series;
  // the corresponding SA series has the same item code and area code.
  return seriesId.length > 2 ? `${seriesId.slice(0, 2)}U${seriesId.slice(3)}` : seriesId;
}

export async function getBlsCpiRelativeImportance(metricIds: string[]): Promise<Record<string, WeightPoint[]>> {
  const definitions = metricIds.flatMap(metricId => {
    const metric = METRICS.find(item => item.id === metricId && item.region === "US");
    return metric?.source === "bls" && metric.seriesId.startsWith("CUS")
      ? [{ metricId, seriesId: nsaSeriesId(metric.seriesId) }]
      : [];
  });
  if (!definitions.length) return {};
  try {
    const rows = await loadAspectRows(new Set(definitions.map(definition => definition.seriesId)));
    return Object.fromEntries(definitions.flatMap(({ metricId, seriesId }) => {
      const points = rows.get(seriesId);
      return points?.length ? [[metricId, points] as const] : [];
    }));
  } catch (error) {
    // Keep the card usable with its existing official annual reference weights
    // if BLS's metadata file is temporarily unavailable.
    console.warn("Unable to load BLS CPI relative-importance history", error);
    return {};
  }
}

export const BLS_CPI_RELATIVE_IMPORTANCE_SOURCE = "https://www.bls.gov/cpi/factsheets/using-cpi-metadata-aspect-files.htm";
