type ChartPoint = { date: string; value: number; rawValue?: number | null };
type DashboardRelease = { periodDate: string; releasedAt: string; value: number; expectedValue?: number | null; periodLabel?: string | null };

/** Keep all published readings; omit database bookkeeping and ingestion notes. */
export function compactDashboardPayload<T extends {
  history: ChartPoint[];
  releases?: DashboardRelease[];
}>(payload: Record<string, T | null>): Record<string, T> {
  return Object.fromEntries(Object.entries(payload).flatMap(([id, metric]) => metric ? [[id, {
    ...metric,
    history: metric.history.map(({ date, value, rawValue }) => ({ date, value, ...(rawValue != null && Number.isFinite(rawValue) ? { rawValue } : {}) })),
    releases: metric.releases?.map(({ periodDate, releasedAt, value, expectedValue, periodLabel }) => ({
      periodDate, releasedAt, value,
      ...(expectedValue == null ? {} : { expectedValue }),
      ...(periodLabel == null ? {} : { periodLabel }),
    })),
  } as T]] : []));
}
