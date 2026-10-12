import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
process.argv[2] = "backfill";
process.argv[3] = "--metrics=us-ism-manufacturing-pmi,us-ism-services-pmi,us-sp-global-manufacturing-pmi,us-sp-global-services-pmi,uk-sp-global-manufacturing-pmi,uk-sp-global-services-pmi,uk-sp-global-composite-pmi,ea-sp-global-manufacturing-pmi,ea-sp-global-services-pmi,ea-sp-global-composite-pmi";
await import("./ingest");
