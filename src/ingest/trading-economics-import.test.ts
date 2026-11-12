import assert from "node:assert/strict";

async function main() {
  process.env.DATABASE_URL = "file::memory:";
  const { getClient } = await import("@/db");
  const { refreshTradingEconomicsCalendar } = await import("./trading-economics-calendar");
  const client = getClient();
  await client.execute(`CREATE TABLE calendar_events (id INTEGER PRIMARY KEY, source TEXT, country TEXT, currency TEXT, event_name TEXT, released_at TEXT, forecast REAL, raw_forecast TEXT, metric_id TEXT, dump_file TEXT, imported_at TEXT, UNIQUE(source,country,event_name,released_at))`);
  await client.execute("INSERT INTO calendar_events(source,country,event_name,released_at,forecast,metric_id,imported_at) VALUES('investing','US','old','2026-11-12T13:30:00.000Z',123,'us-initial-claims','2026-11-11T00:00:00.000Z')");
  const realFetch = globalThis.fetch;
  let forecast = "189K";
  globalThis.fetch = async () => new Response(JSON.stringify([{ CalendarId: "1", Country: "United States", Event: "Initial Jobless Claims", Date: "2026-11-12T13:30:00", Forecast: forecast }]), { status: 200 });
  try {
    await refreshTradingEconomicsCalendar("secret", new Date("2026-11-11T12:00:00Z"));
    forecast = "195K";
    await refreshTradingEconomicsCalendar("secret", new Date("2026-11-11T13:00:00Z"));
    const result = await client.execute("SELECT source,forecast FROM calendar_events ORDER BY source");
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].source, "investing");
    assert.equal(result.rows[1].source, "tradingeconomics");
    assert.equal(result.rows[1].forecast, 195000);
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(() => refreshTradingEconomicsCalendar("secret", new Date("2026-11-11T14:00:00Z")));
    assert.equal((await client.execute("SELECT forecast FROM calendar_events WHERE source='tradingeconomics'")).rows[0].forecast, 195000);
  } finally { globalThis.fetch = realFetch; client.close(); }
  console.log("Trading Economics import, update and failure checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
