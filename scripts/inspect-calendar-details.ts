import { getClient } from "../src/db";
import { getEconomicCalendarRows } from "../src/lib/economic-calendar-db";
import { METRICS } from "../src/catalog/metrics";

async function main() {
  const client = getClient();
  const schedule = await getEconomicCalendarRows({ includeUnscheduled: true });
  
  console.log("Total calendar schedule rows:", schedule.length);
  
  // Look at Eurostat retail sales rows in calendar
  const eaRetail = schedule.filter(s => s.metricId.includes("ea-retail"));
  console.log("EA Retail in calendar:", JSON.stringify(eaRetail, null, 2));

  // Look at releases table
  const releases = await client.execute("SELECT * FROM releases WHERE metric_id LIKE 'ea-retail%'");
  console.log("EA Retail in releases table:", JSON.stringify(releases.rows, null, 2));

  // Check how many metrics have exact time vs date only vs null in calendar schedule
  let exactTimeCount = 0;
  let dateOnlyCount = 0;
  let noDateCount = 0;

  for (const s of schedule) {
    if (s.nextReleaseAt) exactTimeCount++;
    else if (s.nextReleaseDate) dateOnlyCount++;
    else noDateCount++;
  }

  console.log({ exactTimeCount, dateOnlyCount, noDateCount });
}

main().catch(console.error);
