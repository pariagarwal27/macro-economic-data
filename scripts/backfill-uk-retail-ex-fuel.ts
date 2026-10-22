import fs from "node:fs";
import path from "node:path";
import { getClient } from "../src/db";

const metricId = "uk-retail-sales-ex-fuel";
const sourceUrl = "https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j45w/drsi";
const csvPath = path.join(process.cwd(), "data", "uk-retail-sales-j45w-2026-10-19.csv");
const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
const rows = lines.slice(1).map((line) => {
  const [date, rawValue] = line.split(",");
  const value = Number(rawValue);
  if (!/^\d{4}-\d{2}-01$/.test(date ?? "") || !Number.isFinite(value)) {
    throw new Error(`Invalid ONS J45W row: ${line}`);
  }
  return { date, value };
});

if (rows.length !== 463 || rows.at(-1)?.date !== "2026-08-01" || rows.at(-1)?.value !== 0.6) {
  throw new Error(`Unexpected ONS J45W history (${rows.length} rows; latest ${rows.at(-1)?.date}=${rows.at(-1)?.value})`);
}

async function main() {
  const client = getClient();
  const vintageDate = "2026-10-19";
  await client.execute("BEGIN");
  try {
    await client.execute({
      sql: "UPDATE metrics SET series_id = ?, official_url = ?, description = ?, name = ?, short_name = ?, last_ingested_at = ?, earliest_available = ?, observation_count = ? WHERE id = ?",
      args: ["J45W", sourceUrl, "ONS total retail sales volume excluding automotive fuel, seasonally adjusted; published month-on-month growth rate.", "UK Retail Sales — Ex Fuel", "Retail ex Fuel", new Date().toISOString(), rows[0]!.date, rows.length, metricId],
    });
    await client.execute({ sql: "DELETE FROM observations WHERE metric_id = ?", args: [metricId] });
    for (let start = 0; start < rows.length; start += 100) {
      const chunk = rows.slice(start, start + 100);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(",");
      const args = chunk.flatMap(({ date, value }) => [metricId, date, value, value, null, vintageDate]);
      await client.execute({
        sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest) VALUES ${placeholders}`,
        args,
      });
    }
    await client.execute("COMMIT");
  } catch (error) {
    await client.execute("ROLLBACK");
    throw error;
  }
  const latest = await client.execute({
    sql: "SELECT date, value FROM observations WHERE metric_id = ? ORDER BY date DESC LIMIT 1",
    args: [metricId],
  });
  console.log(JSON.stringify({ metricId, seriesId: "J45W", rows: rows.length, latest: latest.rows[0], sourceUrl }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
