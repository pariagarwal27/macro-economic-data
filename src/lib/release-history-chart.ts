import { calendarWindow, type DriverHistoryPoint } from "./release-driver-model";

export type HistoryChartInput = {
  id: string;
  label: string;
  classification?: string;
  subtotal?: boolean;
  history: DriverHistoryPoint[];
};

export type HistoryChartSegment = {
  id: string;
  label: string;
  classification: string;
  value: number | null;
  start: number | null;
  end: number | null;
};

export type HistoryChartMonth = {
  period: string;
  segments: HistoryChartSegment[];
  positiveTotal: number;
  negativeTotal: number;
  shownNet: number | null;
  partial: boolean;
  availableCount: number;
  missingCount: number;
  headline: number | null;
};

/** Sort by signed value: largest positive first, missing/non-finite values last. */
export function sortTooltipComponents<T extends { value: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const av = a.value != null && Number.isFinite(a.value) ? a.value : null;
    const bv = b.value != null && Number.isFinite(b.value) ? b.value : null;
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    return bv - av;
  });
}


/** Build disjoint positive/negative stacks from already-disjoint component effects.
 * Missing months remain missing; the shown net never claims to be the headline. */
export function buildReleaseHistoryChart(
  rows: HistoryChartInput[], selectedMonth: string, headlines: DriverHistoryPoint[] = [],
): HistoryChartMonth[] {
  const seen = new Set<string>();
  const unique = rows.filter(row => {
    if (row.subtotal || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const rowMaps = unique.map(row => {
    const values = new Map<string, number>();
    for (const point of row.history) {
      if (point.value != null && Number.isFinite(point.value)) values.set(point.period, point.value);
    }
    return values;
  });
  const headlineMap = new Map<string, number>();
  for (const point of headlines) {
    if (point.value != null && Number.isFinite(point.value)) headlineMap.set(point.period, point.value);
  }
  return calendarWindow(selectedMonth).map(period => {
    let positiveTotal = 0, negativeTotal = 0, availableCount = 0;
    const segments = unique.map((row, index): HistoryChartSegment => {
      const value = rowMaps[index].get(period) ?? null;
      let start: number | null = null, end: number | null = null;
      if (value != null) {
        availableCount++;
        if (value >= 0) { start = positiveTotal; positiveTotal += value; end = positiveTotal; }
        else { start = negativeTotal; negativeTotal += value; end = negativeTotal; }
      }
      return { id: row.id, label: row.label, classification: row.classification ?? "unclassified", value, start, end };
    });
    const missingCount = unique.length - availableCount;
    return { period, segments, positiveTotal, negativeTotal, shownNet: availableCount ? positiveTotal + negativeTotal : null,
      partial: missingCount > 0, availableCount, missingCount, headline: headlineMap.get(period) ?? null };
  });
}
