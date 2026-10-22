import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { METRICS } from "../src/catalog/metrics";

async function main() {
  dotenv.config({ path: [".env.local", ".env"], quiet: true });
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
    throw new Error("This backfill only operates on the local dashboard SQLite database.");
  }

  const metricIds = [
    "ea-ppi-yoy", "ea-ppi-mom",
    "ea-ppi-capital-goods-yoy", "ea-ppi-capital-goods-mom",
    "ea-ppi-intermediate-goods-yoy", "ea-ppi-intermediate-goods-mom",
    "ea-ppi-durable-consumer-goods-yoy", "ea-ppi-durable-consumer-goods-mom",
    "ea-ppi-non-durable-consumer-goods-yoy", "ea-ppi-non-durable-consumer-goods-mom",
    "ea-ppi-energy-yoy", "ea-ppi-energy-mom",
  ];
  const metrics = metricIds.map(id => METRICS.find(metric => metric.id === id));
  if (metrics.some(metric => !metric?.seriesId || metric.source !== "eurostat")) {
    throw new Error("An expected Eurostat PPI metric or series mapping is missing.");
  }

  const { fetchEurostatPreset } = await import("../src/ingest/eurostat");
  const august2026Release = new Map<string, number>([
    ["ea-ppi-yoy", 8.2], ["ea-ppi-mom", 1.9],
    ["ea-ppi-capital-goods-yoy", 2.6], ["ea-ppi-capital-goods-mom", 0.2],
    ["ea-ppi-intermediate-goods-yoy", 6.8], ["ea-ppi-intermediate-goods-mom", 0.4],
    ["ea-ppi-durable-consumer-goods-yoy", 3.4], ["ea-ppi-durable-consumer-goods-mom", 0.4],
    ["ea-ppi-non-durable-consumer-goods-yoy", -0.8], ["ea-ppi-non-durable-consumer-goods-mom", 0.1],
    ["ea-ppi-energy-yoy", 21.0], ["ea-ppi-energy-mom", 5.6],
  ]);
  for (const metric of metrics) {
    const points = await fetchEurostatPreset(metric!.seriesId);
    if (points.length < 120) throw new Error(`${metric!.id}: only ${points.length} upstream observations; stopping before writing.`);
    const august2026 = points.find(point => point.date === "2026-08-01");
    const officialValue = august2026Release.get(metric!.id);
    if (!august2026 || officialValue == null || Math.abs(august2026.value - officialValue) > 0.05) {
      throw new Error(`${metric!.id}: August 2026 upstream value ${august2026?.value ?? "missing"} does not match Eurostat's 5 October release (${officialValue ?? "no reference"}); stopping before writing.`);
    }
    console.log(`${metric!.id}: ${points.length} upstream observations, latest ${points.at(-1)?.date ?? "—"}`);
  }

  const { getClient } = await import("../src/db");
  const client = getClient();
  const backupDir = path.join(process.cwd(), "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `macro-before-ea-ppi-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  await client.execute({ sql: "VACUUM INTO ?", args: [backup] });
  console.log(`Database backup: ${backup}`);

  const { runIngest } = await import("../src/ingest/pipeline");
  const result = await runIngest("backfill", { metricIds });
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length || result.metricsProcessed !== metricIds.length) {
    throw new Error("Euro Area PPI backfill was incomplete; see the series failures above.");
  }

  const coverage = await client.execute({
    sql: `SELECT metric_id, COUNT(*) AS observations, MIN(date) AS first_period, MAX(date) AS latest_period FROM observations WHERE metric_id IN (${metricIds.map(() => "?").join(",")}) GROUP BY metric_id`,
    args: metricIds,
  });
  if (coverage.rows.length !== metricIds.length || coverage.rows.some(row => Number(row.observations) < 120)) {
    throw new Error("A Euro Area PPI series is missing after ingestion or has fewer than 120 monthly observations.");
  }
  console.log(JSON.stringify(coverage.rows, null, 2));
  client.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
