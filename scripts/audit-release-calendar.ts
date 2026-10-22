import { writeFile } from "node:fs/promises";
import { GET } from "../src/app/api/economic-calendar/route";
import { getDashboardCalendarMetrics } from "../src/lib/dashboard-calendar-metrics";

async function main() {
const response = await GET();
if (!response.ok) throw new Error(`Calendar API returned ${response.status}: ${await response.text()}`);
const payload = await response.json();
const metrics = new Map(getDashboardCalendarMetrics().map(metric => [metric.id, metric]));
const events = payload.nextReleaseEvents.map((event: { metricId: string }) => ({
  ...event,
  releaseName: metrics.get(event.metricId)?.releaseName,
  officialUrl: metrics.get(event.metricId)?.officialUrl,
  frequency: metrics.get(event.metricId)?.frequency,
}));
const report = { checkedAt: new Date().toISOString(), today: payload.today, lastUpdated: payload.lastUpdated, events };
const output = process.argv[2] ?? "data/calendar-release-audit-before.json";
await writeFile(output, JSON.stringify(report, null, 2));
for (const region of ["US", "UK", "EA"]) {
  const rows = events.filter((event: { region: string }) => event.region === region);
  const missing = rows.filter((event: { scheduledDate: string | null; scheduleType: string }) => !event.scheduledDate && !["daily", "hourly"].includes(event.scheduleType));
  console.log(JSON.stringify({ region, total: rows.length, missing: missing.map((event: { metricId: string; metricName: string; family: string | null; releaseName?: string }) => ({ id: event.metricId, name: event.metricName, family: event.family, releaseName: event.releaseName })) }));
}
console.log(`Audit saved to ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
