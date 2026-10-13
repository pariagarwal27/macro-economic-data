export type ClaimsChartPoint = { date: string; value: number };
export type CombinedClaimsChartPoint = { date: string; initial: number | null; continuing: number | null };

/** Align the weekly claims series on one date axis without filling missing weeks. */
export function mergeClaimsChartData(
  initial: ClaimsChartPoint[],
  continuing: ClaimsChartPoint[],
): CombinedClaimsChartPoint[] {
  const byDate = new Map<string, CombinedClaimsChartPoint>();
  for (const point of initial) {
    const row = byDate.get(point.date) ?? { date: point.date, initial: null, continuing: null };
    row.initial = point.value;
    byDate.set(point.date, row);
  }
  for (const point of continuing) {
    const row = byDate.get(point.date) ?? { date: point.date, initial: null, continuing: null };
    row.continuing = point.value;
    byDate.set(point.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
