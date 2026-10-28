type ChartPoint = { date: string; value: number };
type DashboardRelease = { periodDate: string; releasedAt: string; value: number; periodLabel?: string | null };

/** Keep all published readings; omit database bookkeeping and ingestion notes. */
export function compactDashboardPayload<T extends {
  history: ChartPoint[];
  releases?: DashboardRelease[];
}>(payload: Record<string, T | null>): Record<string, T> {
  return Object.fromEntries(Object.entries(payload).flatMap(([id, metric]) => metric ? [[id, {
    ...metric,
    history: metric.history.map(({ date, value }) => ({ date, value })),
    releases: metric.releases?.map(({ periodDate, releasedAt, value, periodLabel }) => ({
      periodDate, releasedAt, value, ...(periodLabel == null ? {} : { periodLabel }),
    })),
  } as T]] : []));
}
