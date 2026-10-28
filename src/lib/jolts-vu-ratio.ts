export type JoltsReading = { date: string; value: number | null };
export type JoltsVuReading = { date: string; value: number };
export type JoltsVuTrendReading = { date: string; value: number | null };

/** Calculate openings per unemployed person from same-date, thousand-based levels. */
export function joltsVuRatio(
  openings: readonly JoltsReading[],
  unemployed: readonly JoltsReading[],
): JoltsVuReading[] {
  const unemployedByDate = new Map(
    unemployed
      .filter((point) => Number.isFinite(point.value) && point.value! > 0)
      .map((point) => [point.date, point.value!] as const),
  );
  return openings
    .filter((point): point is JoltsReading & { value: number } =>
      Number.isFinite(point.value) && unemployedByDate.has(point.date),
    )
    .map((point) => ({ date: point.date, value: point.value / unemployedByDate.get(point.date)! }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Calculate a trailing three-month average, leaving gaps and warm-up months blank. */
export function joltsVuThreeMonthAverage(
  readings: readonly JoltsVuReading[],
): JoltsVuTrendReading[] {
  const ordered = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  return ordered.map((point, index) => {
    if (index < 2) return { date: point.date, value: null };
    const window = ordered.slice(index - 2, index + 1);
    const contiguous = window.every((item, offset) => {
      if (!offset) return true;
      const previous = new Date(`${window[offset - 1]!.date.slice(0, 7)}-01T00:00:00Z`);
      const current = new Date(`${item.date.slice(0, 7)}-01T00:00:00Z`);
      return (current.getUTCFullYear() - previous.getUTCFullYear()) * 12 + current.getUTCMonth() - previous.getUTCMonth() === 1;
    });
    return {
      date: point.date,
      value: contiguous ? window.reduce((sum, item) => sum + item.value, 0) / 3 : null,
    };
  });
}
