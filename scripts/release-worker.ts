import { loadEnvConfig } from "@next/env";
import { logReleaseEvent } from "../src/ingest/release-logging";
import { METRICS } from "../src/catalog/metrics";
import { UK_RETAIL_RELEASE_IDS } from "../src/lib/uk-retail";
import { createEaMarketRefresh, EA_MARKET_METRIC_IDS } from "../src/ingest/ea-market-refresh";

loadEnvConfig(process.cwd());

async function main() {
  const { ensureSchema, seedCatalog, runIngest } = await import("../src/ingest/pipeline");
  const { executeRead } = await import("../src/db");
  const underlyingIds = METRICS
    .filter(metric => metric.id === "us-sticky-cpi" || metric.id === "us-core-sticky-cpi" || metric.id === "us-flexible-cpi" || metric.id === "us-cleveland-median-pce" || metric.id === "us-cleveland-median-pce-mom" || metric.id === "us-dallas-trimmed-mean-pce" || metric.id === "us-dallas-trimmed-mean-pce-mom" || metric.id === "us-cleveland-median-cpi" || metric.id === "us-cleveland-trimmed-cpi" || metric.id.endsWith("-sticky-cpi-mom") || metric.id.endsWith("-flexible-cpi-mom") || metric.id.endsWith("-cleveland-median-cpi-mom") || metric.id.endsWith("-cleveland-trimmed-cpi-mom"))
    .map(metric => metric.id);
  await ensureSchema();
  await seedCatalog({ metricIds: [...underlyingIds, ...UK_RETAIL_RELEASE_IDS] });

  // Market quotes do not have monthly release events. Keep their local LSEG
  // history and tip updated independently of calendar-driven dispatch.
  const marketEnabled = Boolean(process.env.LSEG_WORKER_URL);
  if (marketEnabled) await seedCatalog({ metricIds: EA_MARKET_METRIC_IDS });
  const refreshEaMarket = createEaMarketRefresh({
    missingHistory: async () => {
      const result = await executeRead({
        sql: `SELECT m.id FROM metrics m WHERE m.id IN (${EA_MARKET_METRIC_IDS.map(() => "?").join(",")})
          AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.metric_id = m.id)`,
        args: EA_MARKET_METRIC_IDS,
      });
      return result.rows.map(row => String(row.id));
    },
    ingest: runIngest,
  });
  const pollEaMarket = async () => {
    if (!marketEnabled) return;
    try {
      await refreshEaMarket();
    } catch (error) {
      logReleaseEvent({ event: "ea_market_refresh_failed", error: error instanceof Error ? error.message : String(error) });
      if (process.env.RUN_ONCE === "1") process.exitCode = 1;
    }
  };

  const { dispatchDueReleases } = await import("../src/ingest/release-dispatcher");

  const interval = Number(process.env.RELEASE_WORKER_INTERVAL_MS ?? 1000);
  if (!Number.isFinite(interval) || interval < 1000) {
    throw new Error("RELEASE_WORKER_INTERVAL_MS must be at least 1000");
  }

  const runOnce = process.env.RUN_ONCE === "1";
  logReleaseEvent({
    event: "worker_started",
    discoveryIntervalMs: interval,
    retryDelayMs: "1000 for LSEG near release, 5000 otherwise",
    dispatchMode: "all-eligible-metrics-concurrent",
    retryMode: "source-aware-independent-per-metric",
    runOnce,
  });

  const prepareAheadMs = Math.min(60_000, Math.max(10_000, interval + 5_000));
  const dispatch = () => dispatchDueReleases({ retryForMs: runOnce ? 0 : Infinity, prepareAheadMs: runOnce ? 0 : prepareAheadMs })
    .then(result => {
      if (result.attempted > 0) {
        logReleaseEvent({
          event: "cycle_completed",
          checkedAt: result.checkedAt,
          scheduledDue: result.scheduledDue,
          safetyDue: result.safetyDue,
          eligible: result.eligible,
          attempted: result.attempted,
        });
      }
    }).catch(error => {
      logReleaseEvent({
        event: "worker_cycle_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      if (runOnce) process.exitCode = 1;
    });

  if (runOnce) {
    await Promise.all([dispatch(), pollEaMarket()]);
    return;
  }

  do {
    // Discover new releases while earlier metrics are still fetching/retrying.
    // The dispatcher owns one independent request stream per metric.
    void dispatch();
    void pollEaMarket();
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (true);
}

main().catch((error) => {
  logReleaseEvent({
    event: "worker_start_failed",
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
