/** Presentation model shared by inflation and retail release cards. */
export type DriverClassification = "sticky" | "flexible" | "mixed" | "unclassified";
export type DriverHistoryPoint = { period: string; value: number | null };
export type ReleaseDriverRow = {
  id: string;
  label: string;
  metricId?: string;
  weight: number | null;
  weightSource?: string;
  weightNote?: string;
  rate: number | null;
  current: number | null;
  previous: number | null;
  classification: DriverClassification;
  history: DriverHistoryPoint[];
  rateHistory?: DriverHistoryPoint[];
  effectHistory?: DriverHistoryPoint[];
  threeMonthSaar?: number | null;
  threeMonthEffect?: number | null;
};
export const CLASSIFICATION_SOURCE = "https://www.atlantafed.org/research-and-data/data/sticky-price-cpi/explainer";
export const CLASSIFICATION_TABLE = "https://www.clevelandfed.org/publications/economic-commentary/ec-201002-are-some-prices-in-the-cpi-more-forward-looking-than-others-we-think-so";

export function calendarWindow(period: string, length = 6): string[] {
  const [year, month] = period.split("-").map(Number);
  return Array.from({ length }, (_, index) => new Date(Date.UTC(year, month - length + index, 1)).toISOString().slice(0, 7));
}
export function finiteMedian(values: Array<number | null>): number | null {
  const sorted = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function rankedDrivers<T extends { id: string; label: string; current: number | null; rate: number | null }>(rows: T[], effects: boolean): T[] {
  const magnitude = (row: T) => {
    const value = effects ? row.current : row.rate;
    return value != null && Number.isFinite(value) ? Math.abs(value) : -Infinity;
  };
  return [...rows].sort((a, b) => magnitude(b) - magnitude(a) || a.label.localeCompare(b.label));
}
/** Assign the U.S. CPI component rows to the sticky / flexible divisions used
 * by the published CPI classification reference. Broad baskets keep their
 * existing mixed / unclassified labels. */
export function classifyCpiDriver(id: string): DriverClassification {
  if ([
    "us-cpi-medical-services",
    "us-cpi-recreation-services",
    "us-cpi-medical-commodities",
    "us-cpi-education-services",
    "us-cpi-shelter",
    "us-cpi-transport-services",
    "us-cpi-other-services",
  ].includes(id)) return "sticky";
  if ([
    "us-cpi-energy",
    "us-cpi-used-cars",
    "us-cpi-new-vehicles",
    "us-cpi-recreation-commodities",
    "us-cpi-apparel",
    "us-cpi-food",
    "us-cpi-education-commodities",
    "us-cpi-other-goods",
  ].includes(id)) return "flexible";
  if (id === "us-services-cpi-yoy" || id === "us-core-goods-cpi-yoy") return "mixed";
  return "unclassified";
}
type TreeNode = { id: string; metricId?: string; children?: TreeNode[] };
/** Prefer mapped descendants; retain an aggregate only if it has no mapped
 * descendants. This prevents an aggregate and its children sharing a total. */
export function disjointNodes<T extends TreeNode>(nodes: T[]): T[] {
  return nodes.flatMap(node => {
    const children = disjointNodes((node.children ?? []) as T[]);
    return children.length ? children : node.metricId ? [node] : [];
  });
}
export function driverDomain(values: Array<number | null>): [number, number] {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  const low = Math.min(0, ...finite), high = Math.max(0, ...finite);
  const padding = Math.max((high - low) * 0.12, 0.01);
  return [low < 0 ? low - padding : 0, high > 0 ? high + padding : padding];
}
export function driverTotals(rows: ReleaseDriverRow[]) {
  const covered = rows.filter(row => row.current != null && Number.isFinite(row.current));
  const current = covered.length ? covered.reduce((sum, row) => sum + row.current!, 0) : null;
  const previous = covered.length && covered.every(row => row.previous != null && Number.isFinite(row.previous))
    ? covered.reduce((sum, row) => sum + row.previous!, 0) : null;
  const weight = covered.length && covered.every(row => row.weight != null)
    ? covered.reduce((sum, row) => sum + row.weight!, 0) : null;
  return { current, previous, weight, change: current != null && previous != null ? current - previous : null };
}
