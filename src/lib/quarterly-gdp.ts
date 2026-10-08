export type QuarterlyGrowthObservation = {
  date: string;
  value: number;
};

export type QuarterlyGrowthPoint = {
  date: string;
  quarter: string;
  value: number;
};

export function quarterLabel(date: string): string {
  const normalizedQuarter = date.match(/^(\d{4})[- ]Q([1-4])$/i);
  if (normalizedQuarter) return `Q${normalizedQuarter[2]} ${normalizedQuarter[1]}`;

  const isoDate = date.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (!isoDate) return date;

  const month = Number(isoDate[2]);
  if (month < 1 || month > 12) return date;
  return `Q${Math.floor((month - 1) / 3) + 1} ${isoDate[1]}`;
}

export function quarterlyGrowthPoints(
  history: QuarterlyGrowthObservation[],
  limit = 10
): QuarterlyGrowthPoint[] {
  return history
    .filter((point) => Number.isFinite(Number(point.value)) && quarterLabel(point.date) !== point.date)
    .map((point) => ({
      date: point.date.slice(0, 10),
      quarter: quarterLabel(point.date),
      value: Number(point.value),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-Math.max(1, limit));
}

export function latestQuarterPair(history: QuarterlyGrowthObservation[]) {
  const points = quarterlyGrowthPoints(history, 2);
  return {
    latest: points.at(-1) ?? null,
    prior: points.at(-2) ?? null,
  };
}
