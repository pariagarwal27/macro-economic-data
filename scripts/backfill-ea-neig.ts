import { getSeriesHistory, runIngest } from "../src/ingest/pipeline";

async function main() {
  const metricIds = ["ea-goods-hicp-yoy", "ea-goods-hicp-mom"];
  const result = await runIngest("backfill", { metricIds });
  console.log(JSON.stringify(result, null, 2));

  for (const metricId of metricIds) {
    const series = await getSeriesHistory(metricId, 3);
    console.log(`${metricId} latest:`, series?.history.at(-1) ?? null);
  }

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

void main();
