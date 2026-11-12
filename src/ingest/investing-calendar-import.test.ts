import { strict as assert } from "node:assert";

async function main() {
  process.env.DATABASE_URL = "file::memory:";
  const { getClient } = await import("@/db");
  const { importInvestingCalendar } = await import("./investing-calendar");
  const client = getClient();
  await client.execute(`CREATE TABLE calendar_events (id INTEGER PRIMARY KEY, source TEXT, country TEXT, currency TEXT, event_name TEXT, importance INTEGER, released_at TEXT, actual REAL, forecast REAL, previous REAL, raw_actual TEXT, raw_forecast TEXT, raw_previous TEXT, metric_id TEXT, dump_file TEXT, imported_at TEXT, UNIQUE(source,country,event_name,released_at))`);
  const event = { date: "2026-11-12", time: "13:30", country: "US", currency: "USD", event: "Initial Jobless Claims", forecast: "189K" };
  assert.deepEqual(await importInvestingCalendar([event], "capture.json"), { rows: 1, mapped: 1 });
  await importInvestingCalendar([{ ...event, forecast: "195K" }], "capture.json");
  const result = await client.execute("SELECT metric_id,forecast,raw_forecast FROM calendar_events");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].metric_id, "us-initial-claims");
  assert.equal(result.rows[0].forecast, 195000);
  assert.equal(result.rows[0].raw_forecast, "195K");
  client.close();
  console.log("Investing calendar import and update checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
