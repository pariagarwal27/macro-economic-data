export type InflationHistoryPoint = { date: string; value: number };
export type InflationRatePoint = { date: string; value: number | null };
export type InflationRateMode = "yoy" | "mom";

function isIndexTransform(transform: string | null | undefined) {
  return transform === "level" || transform === "index";
}

function toRates(
  history: InflationHistoryPoint[],
  transform: string | null | undefined,
  mode: InflationRateMode,
): InflationRatePoint[] {
  const byMonth = new Map(history.map(point => [point.date.slice(0, 7), point.value]));
  const offset = mode === "yoy" ? 12 : 1;
  return history.map(point => {
    if (!isIndexTransform(transform)) {
      return { date: point.date, value: Number.isFinite(point.value) ? point.value : null };
    }
    const [year, month] = point.date.slice(0, 7).split("-").map(Number);
    if (!year || !month) return { date: point.date, value: null };
    const priorIndex = year * 12 + month - 1 - offset;
    const priorMonth = `${Math.floor(priorIndex / 12)}-${String(priorIndex % 12 + 1).padStart(2, "0")}`;
    const priorValue = byMonth.get(priorMonth);
    return {
      date: point.date,
      value: Number.isFinite(point.value) && Number.isFinite(priorValue) && priorValue! > 0
        ? (point.value / priorValue! - 1) * 100
        : null,
    };
  });
}

/**
 * Prefer published rate observations, then fill any missing periods by deriving
 * the same rate from the official index history. This keeps an incomplete
 * published rate feed from blanking the comparison chart or latest reading.
 */
export function inflationRateHistory(
  preferredHistory: InflationHistoryPoint[],
  preferredTransform: string | null | undefined,
  fallbackHistory: InflationHistoryPoint[],
  fallbackTransform: string | null | undefined,
  mode: InflationRateMode,
): InflationRatePoint[] {
  const merged = new Map<string, InflationRatePoint>();
  for (const point of toRates(fallbackHistory, fallbackTransform, mode)) {
    merged.set(point.date.slice(0, 7), point);
  }
  for (const point of toRates(preferredHistory, preferredTransform, mode)) {
    merged.set(point.date.slice(0, 7), point);
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}
