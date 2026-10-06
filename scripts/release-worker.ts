import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { dispatchDueReleases } = await import("../src/ingest/release-dispatcher");

  const interval = Number(process.env.RELEASE_WORKER_INTERVAL_MS ?? 5000);
  if (!Number.isFinite(interval) || interval < 1000) {
    throw new Error("RELEASE_WORKER_INTERVAL_MS must be at least 1000");
  }

  const runOnce = process.env.RUN_ONCE === "1";

  do {
    try {
      const result = await dispatchDueReleases({
        maxMetrics: Number(process.env.RELEASE_MAX_METRICS_PER_CYCLE ?? 40),
      });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error("[release-worker]", error);
      if (runOnce) process.exitCode = 1;
    }

    if (runOnce) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
