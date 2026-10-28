import { runIngest } from "../src/ingest/pipeline";

async function main() {
  const summary = await runIngest("refresh", { metricIds: ["us-adp-change", "us-adp-level"] });
  console.log(JSON.stringify(summary, null, 2));
}
void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
