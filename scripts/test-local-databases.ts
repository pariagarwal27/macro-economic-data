import assert from "node:assert/strict";
import { getClient, executeRead } from "../src/db";
import { getEconomicCalendarRows } from "../src/lib/economic-calendar-db";
import { getSeriesHistories } from "../src/data/dashboard";

async function main() {
  try {
    const counts = await executeRead({ sql: "SELECT COUNT(*) AS n FROM metrics" });
    assert.equal(Number(counts.rows[0].n), 349);
    const schedule = await getEconomicCalendarRows();
    assert.ok(schedule.length > 0, "The second local SQLite database must load");
    const series = await getSeriesHistories(["us-cpi", "uk-cpi-yoy", "ea-hicp-yoy"], 60);
    for (const id of ["us-cpi", "uk-cpi-yoy", "ea-hicp-yoy"]) {
      assert.ok(series[id]?.history.length, `${id} must have local observations`);
    }
    console.log(`Local SQLite: 349 metrics, ${schedule.length} scheduled records; US/UK/EA history reads passed`);
  } finally { try { getClient().close(); } catch { /* Failed client creation. */ } }
}
void main();
