import { loadEnvConfig } from "@next/env";

loadEnvConfig(
  process.cwd()
);

async function main() {
  const {
    getSourceConfig,
  } = await import(
    "../src/ingest/source-registry"
  );

  const {
    fetchMetricFromOfficialSource,
  } = await import(
    "../src/ingest/source-adapter"
  );

  const metricId =
    "us-core-pce";

  const config =
    getSourceConfig(
      metricId
    );

  console.log(
    "SOURCE CONFIG:"
  );

  console.dir(
    config,
    {
      depth: null,
    }
  );

  if (!config) {
    throw new Error(
      "No source configuration"
    );
  }

  const result =
    await fetchMetricFromOfficialSource(
      metricId
    );

  console.log(
    "\nBEA RESULT:"
  );

  console.dir(
    result,
    {
      depth: null,
    }
  );

  if (!result) {
    throw new Error(
      "BEA returned no data"
    );
  }

  console.log(
    "\nperiodDate:",
    result.periodDate
  );

  console.log(
    "value:",
    result.value
  );

  console.log(
    "releasedAt:",
    result.releasedAt
  );
}

main().catch(
  (error) => {
    console.error(
      error
    );

    process.exit(1);
  }
);