import { writeFileSync } from "node:fs";
import path from "node:path";
import { METRICS } from "../src/catalog/metrics";

writeFileSync(path.join(process.cwd(), "Economic_calendar/catalog_metrics.json"), JSON.stringify({ metrics: METRICS.map(metric => ({ id: metric.id, name: metric.name, source: metric.source, frequency: metric.frequency, official_url: metric.officialUrl })) }, null, 2));
console.log(`Exported ${METRICS.length} authoritative calendar metric IDs`);
