export const EA_MARKET_METRIC_IDS = [
  "ea-inflation-comp-1y", "ea-inflation-comp-2y", "ea-inflation-comp-5y",
  "ea-inflation-comp-10y", "ea-inflation-comp-5y5y",
];

type Dependencies = {
  missingHistory: () => Promise<string[]>;
  ingest: (mode: "backfill" | "refresh", options: { metricIds: string[] }) => Promise<{
    failures: Array<{ metricId: string; error: string }>;
  }>;
};

export function createEaMarketRefresh(dependencies: Dependencies) {
  let active = false;
  let nextAttemptAt = 0;
  let historyReady = false;
  return async (now = new Date()) => {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Brussels", weekday: "short",
    }).format(now);
    if (active || now.getTime() < nextAttemptAt || weekday === "Sat" || weekday === "Sun") return;
    active = true;
    nextAttemptAt = now.getTime() + 15 * 60_000;
    try {
      const errors: Array<{ metricId: string; error: string }> = [];
      if (!historyReady) {
        const missing = (await dependencies.missingHistory()).filter(id => EA_MARKET_METRIC_IDS.includes(id));
        if (missing.length) {
          const result = await dependencies.ingest("backfill", { metricIds: missing });
          errors.push(...result.failures);
        }
        historyReady = errors.length === 0;
      }
      const result = await dependencies.ingest("refresh", { metricIds: EA_MARKET_METRIC_IDS });
      errors.push(...result.failures);
      if (errors.length) throw new Error(JSON.stringify(errors));
    } finally {
      active = false;
    }
  };
}
