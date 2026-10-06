import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { runIngest, getSeriesHistory } = await import(
    "../src/ingest/pipeline"
  );

  const metricIds = [
    "uk-gfcf-level",
    "uk-gfcf-yoy",
    "uk-gfcf-qoq",
  ];

  console.log("Project:", process.cwd());

  const result = await runIngest("refresh", { metricIds });
  console.log("Refresh result:", JSON.stringify(result, null, 2));

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }

  for (const id of metricIds) {
    const saved = await getSeriesHistory(id, 24);

    console.log(`\n${id} — saved 2026 values:`);
    console.table(
      saved?.history
        .filter((point) => point.date.startsWith("2026-"))
        .map(({ date, value }) => ({ date, value }))
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});