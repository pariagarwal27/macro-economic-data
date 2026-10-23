export type PublishedExpectationReading = { date: string; value: number };

/** Normalizes expectation history without interpreting published levels as rates. */
export function getPublishedExpectationReadings(
  history: Array<{ date: string; value: number }>,
): PublishedExpectationReading[] {
  return history
    .map((point) => ({ date: String(point.date).slice(0, 10), value: Number(point.value) }))
    .filter((point) => point.date.length > 0 && Number.isFinite(point.value))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/** Excludes forecast/future-dated rows that have not been published as of the current date. */
export function getPublishedExpectationReadingsAsOf(
  history: Array<{ date: string; value: number }>,
  asOf = new Date(),
): PublishedExpectationReading[] {
  const cutoff = asOf.toISOString().slice(0, 10);
  const cutoffMonth = cutoff.slice(0, 7);
  const cutoffYear = cutoff.slice(0, 4);
  return getPublishedExpectationReadings(history).filter(({ date }) => {
    if (/^\d{4}$/.test(date)) return date <= cutoffYear;
    if (/^\d{4}-\d{2}/.test(date)) return date.slice(0, 7) <= cutoffMonth && date <= cutoff;
    return date <= cutoff;
  });
}
