import { runIngest } from "../src/ingest/pipeline";

const metricIds = [
  "ea-spf-hicp-target-2026",
  "ea-spf-hicp-target-2027",
  "ea-spf-hicp-target-2028",
  "ea-spf-hicp-lt",
  ...(["core", "gdp", "unemployment", "wage"] as const).flatMap((component) =>
    ["2026", "2027", "2028", "lt"].map((target) => `ea-spf-${component}-target-${target}`)
  ),
];

runIngest("backfill", { metricIds })
  .then((summary) => console.log(JSON.stringify(summary, null, 2)))
  .catch((error) => {
    console.error("ECB SPF quarterly forecast backfill failed:", error);
    process.exitCode = 1;
  });
