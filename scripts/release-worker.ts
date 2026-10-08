import { loadEnvConfig } from "@next/env";
import { logReleaseEvent } from "../src/ingest/release-logging";

loadEnvConfig(process.cwd());

async function main() {
  const { dispatchDueReleases } = await import("../src/ingest/release-dispatcher");

  const interval = Number(process.env.RELEASE_WORKER_INTERVAL_MS ?? 5000);
  if (!Number.isFinite(interval) || interval < 1000) {
    throw new Error("RELEASE_WORKER_INTERVAL_MS must be at least 1000");
  }

  const runOnce = process.env.RUN_ONCE === "1";
  const maxMetrics = Number(process.env.RELEASE_MAX_METRICS_PER_CYCLE ?? 40);
  logReleaseEvent({
    event: "worker_started",
    pollIntervalMs: interval,
    maxMetricsPerCycle: maxMetrics,
    runOnce,
  });

  do {
    try {
      const result = await dispatchDueReleases({
        maxMetrics,
      });
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
    } catch (error) {
      logReleaseEvent({
        event: "worker_cycle_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      if (runOnce) process.exitCode = 1;
    }

    if (runOnce) break;
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
