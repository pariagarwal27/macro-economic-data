import fs from "node:fs";
import path from "node:path";
import { getClient } from "../src/db";

const metricId = "uk-retail-sales-total-ex-fuel";
const overviewMetricId = "uk-retail-sales-mom";
const sourceUrl = "https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j5ec/drsi";
const csvPath = path.join(process.cwd(), "data", "uk-retail-sales-j5ec-2026-10-19.csv");
const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
const rows = lines.slice(1).map((line) => {
  const [date, rawValue] = line.split(",");
  const value = Number(rawValue);
  if (!/^\d{4}-\d{2}-01$/.test(date ?? "") || !Number.isFinite(value)) {
    throw new Error(`Invalid J45W row: ${line}`);
  }
  return { date, value };
});

if (rows.length !== 367 || rows.at(-1)?.date !== "2026-08-01" || rows.at(-1)?.value !== 0.5) {
  throw new Error(`Unexpected ONS J5EC history (${rows.length} rows; latest ${rows.at(-1)?.date}=${rows.at(-1)?.value})`);
}

async function main() {
const client = getClient();
const vintageDate = "2026-10-19";
await client.execute("BEGIN");
try {
  await client.execute({
    sql: "UPDATE metrics SET series_id = ?, official_url = ?, description = ?, name = ?, short_name = ?, last_ingested_at = ?, earliest_available = ?, observation_count = ? WHERE id = ?",
    args: ["J5EC", sourceUrl, "ONS total retail sales volume including automotive fuel, seasonally adjusted; published month-on-month growth rate.", "UK Retail Sales — Headline", "Headline Retail", new Date().toISOString(), rows[0]!.date, rows.length, metricId],
  });
  await client.execute({
    sql: "UPDATE metrics SET series_id = ?, official_url = ?, description = ?, last_ingested_at = ?, earliest_available = ?, observation_count = ? WHERE id = ?",
    args: ["J5EC", sourceUrl, "Headline retail sales volumes month-on-month % change including automotive fuel (ONS J5EC, SA).", new Date().toISOString(), rows[0]!.date, rows.length, overviewMetricId],
  });
  await client.execute({ sql: "DELETE FROM observations WHERE metric_id = ?", args: [metricId] });
  await client.execute({ sql: "DELETE FROM observations WHERE metric_id = ?", args: [overviewMetricId] });
  const chunkSize = 100;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(",");
    const args = chunk.flatMap(({ date, value }) => [metricId, date, value, value, null, vintageDate]);
    await client.execute({
      sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest) VALUES ${placeholders}`,
      args,
    });
    const overviewArgs = chunk.flatMap(({ date, value }) => [overviewMetricId, date, value, value, null, vintageDate]);
    await client.execute({
      sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest) VALUES ${placeholders}`,
      args: overviewArgs,
    });
  }
  await client.execute({
    sql: `UPDATE releases SET value = 0.5, prior_period_value = -0.5, prior_period_date = '2026-07-01',
          change_vs_prior_period = 1.0, prior_release_value = NULL, change_vs_prior_release = NULL,
          supporting_doc_url = ?, notes = 'Backfilled from official ONS J5EC' 
          WHERE metric_id = ? AND period_date = '2026-08-01'`,
    args: [sourceUrl, metricId],
  });
  await client.execute({
    sql: `UPDATE releases SET value = 0.5, prior_period_value = -0.5, prior_period_date = '2026-07-01',
          change_vs_prior_period = 1.0, prior_release_value = NULL, change_vs_prior_release = NULL,
          supporting_doc_url = ?, notes = 'Backfilled from official ONS J5EC'
          WHERE metric_id = ? AND period_date = '2026-08-01'`,
    args: [sourceUrl, overviewMetricId],
  });
  await client.execute("COMMIT");
} catch (error) {
  await client.execute("ROLLBACK");
  throw error;
}

const latest = await client.execute({
  sql: "SELECT date, value FROM observations WHERE metric_id = ? ORDER BY date DESC LIMIT 1",
  args: [metricId],
});
const overviewLatest = await client.execute({
  sql: "SELECT date, value FROM observations WHERE metric_id = ? ORDER BY date DESC LIMIT 1",
  args: [overviewMetricId],
});
console.log(JSON.stringify({ metricId, overviewMetricId, seriesId: "J5EC", rows: rows.length, first: rows[0], latest: latest.rows[0], overviewLatest: overviewLatest.rows[0], sourceUrl }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
