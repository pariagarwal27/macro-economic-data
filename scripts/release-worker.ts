import { loadEnvConfig } from "@next/env";
import { logReleaseEvent } from "../src/ingest/release-logging";
import { METRICS } from "../src/catalog/metrics";

loadEnvConfig(process.cwd());

async function main() {
  const { ensureSchema, seedCatalog } = await import("../src/ingest/pipeline");
  const underlyingIds = METRICS
    .filter(metric => metric.id === "us-sticky-cpi" || metric.id === "us-core-sticky-cpi" || metric.id === "us-flexible-cpi" || metric.id === "us-cleveland-median-cpi" || metric.id === "us-cleveland-trimmed-cpi" || metric.id.endsWith("-sticky-cpi-mom") || metric.id.endsWith("-flexible-cpi-mom") || metric.id.endsWith("-cleveland-median-cpi-mom") || metric.id.endsWith("-cleveland-trimmed-cpi-mom"))
    .map(metric => metric.id);
  await ensureSchema();
  await seedCatalog({ metricIds: underlyingIds });

  const { dispatchDueReleases } = await import("../src/ingest/release-dispatcher");

  const interval = Number(process.env.RELEASE_WORKER_INTERVAL_MS ?? 5000);
  if (!Number.isFinite(interval) || interval < 1000) {
    throw new Error("RELEASE_WORKER_INTERVAL_MS must be at least 1000");
  }

  const runOnce = process.env.RUN_ONCE === "1";
  logReleaseEvent({
    event: "worker_started",
    discoveryIntervalMs: interval,
    retryDelayMs: 0,
    dispatchMode: "all-eligible-metrics-concurrent",
    retryMode: "immediate-independent-per-metric",
    runOnce,
  });

  const dispatch = () => dispatchDueReleases({ retryForMs: runOnce ? 0 : Infinity })
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
    await dispatch();
    return;
  }

  do {
    // Discover new releases while earlier metrics are still fetching/retrying.
    // The dispatcher owns one independent request stream per metric.
    void dispatch();
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
