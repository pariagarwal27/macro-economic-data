import { loadEnvConfig } from "@next/env";
import { EA_MARKET_METRIC_IDS } from "../src/ingest/ea-market-refresh";

loadEnvConfig(process.cwd());

async function main() {
  const worker = process.env.LSEG_WORKER_URL;
  if (!worker) throw new Error("Set LSEG_WORKER_URL to the authenticated LSEG bridge.");
  const health = await fetch(`${worker.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error("Start the updated LSEG bridge with npm run release:lseg.");
  const { runIngest } = await import("../src/ingest/pipeline");
  const result = await runIngest("backfill", { metricIds: EA_MARKET_METRIC_IDS });
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}

main().catch(error => {
  console.error("Euro-area market backfill failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
