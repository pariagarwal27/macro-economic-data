import "dotenv/config";
import { runIngest } from "../src/ingest/pipeline";

const METRIC_IDS = [
  "us-cleveland-exp-inf-1y",
  "us-cleveland-exp-inf-3y",
  "us-cleveland-exp-inf-5y",
  "us-cleveland-exp-inf-10y",
  "us-cleveland-exp-inf-30y",
  "us-umich-inflation-exp-1y",
  "us-umich-inflation-exp-5y",
  "us-atlanta-bie-1y",
  "us-cleveland-sofie-1y",
  "us-cleveland-sofie-5y",
  "us-5y5y-forward",
  "us-breakeven-5y",
  "us-breakeven-10y",
];

async function main() {
  console.log("Backfilling US inflation-expectation components...");
  console.log(METRIC_IDS.join("\n"));

  const summary = await runIngest("backfill", {
    metricIds: METRIC_IDS,
  });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
