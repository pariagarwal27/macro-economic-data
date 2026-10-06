import { runIngest } from "../src/ingest/pipeline";

const metricIds = [
  "uk-dmp-wage-exp-1y",
  "uk-agents-pay-settlement-exp-1y",
];
async function main() {
  console.log("Starting UK inflation expectations backfill...");
  console.log(`Metrics: ${metricIds.length}`);

  const result = await runIngest("backfill", { metricIds });

  console.log("\n===== BACKFILL RESULT =====");
  console.dir(result, { depth: null });
}

main().catch((error) => {
  console.error("\n===== BACKFILL FAILED =====");
  console.error(error);
  process.exit(1);
});