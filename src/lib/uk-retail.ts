type Point = { date: string; value: number };

/** Join actual published observations, without carrying an older value forward. */
export function retailPublishedPoints(headline: Point[], exFuel: Point[]) {
  const indexed = (points: Point[]) => new Map(points.filter(p => Number.isFinite(p.value)).map(p => [p.date.slice(0, 7) + '-01', p.value]));
  const primary = indexed(headline), comparison = indexed(exFuel);
  return [...new Set([...primary.keys(), ...comparison.keys()])].sort().map(date => ({
    date, headline: primary.get(date) ?? null, exFuel: comparison.get(date) ?? null,
  }));
}

export const UK_RETAIL_RELEASE_IDS = [
  'uk-retail-sales-total-ex-fuel', 'uk-retail-sales-mom', 'uk-retail-sales-ex-fuel',
  'uk-retail-sales-total-yoy', 'uk-retail-sales-ex-fuel-yoy',
  'uk-retail-sales-total-3m3m', 'uk-retail-sales-ex-fuel-3m3m',
];

export function retailReleaseCandidates(rows: { metricId: string; nextReleaseDate: string | null; nextReleaseAt: string | null }[], now: Date) {
  // Only the headline calendar event defines this family's release time.
  // A lagging comparison schedule must never pre-empt the official event.
  const events = rows.filter(row => row.metricId === 'uk-retail-sales-total-ex-fuel');
  const candidates = events.flatMap(row => {
    const scheduledAt = row.nextReleaseAt ?? row.nextReleaseDate;
    if (!scheduledAt) return [];
    const elapsed = now.getTime() - Date.parse(scheduledAt);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 3 * 86400000) return [];
    return UK_RETAIL_RELEASE_IDS.map(metricId => ({ metricId, scheduledAt, mode: 'scheduled' as const }));
  });
  return candidates.filter((candidate, index) => candidates.findIndex(other => other.metricId === candidate.metricId) === index);
}

export function isUkRetailReleasePeriod(scheduledAt: string, periodDate: string) {
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  return periodDate.slice(0,7) === new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0,7);
}
