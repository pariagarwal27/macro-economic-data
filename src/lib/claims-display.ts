export type ClaimsObservation = { date: string; value: number };

export type ClaimsChartPoint = { date: string; value: number };

export function formatClaimsCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function claimsChartPoints(history: readonly ClaimsObservation[]): ClaimsChartPoint[] {
  return history
    .map(({ date, value }) => ({ date: date.slice(0, 10), value: Number(value) }))
    .filter(({ date, value }) => Boolean(date) && Number.isFinite(value))
    .sort((a, b) => a.date.localeCompare(b.date));
}
