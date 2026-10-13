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
