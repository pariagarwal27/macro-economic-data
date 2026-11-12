/** Populate only the new PCE expenditure inputs from BEA NIPA Table 2.8.5.
 * Existing observations are preserved; no release events are manufactured. */
import "dotenv/config";
import { getClient } from "../src/db";
import { ensureSchema, seedCatalog } from "../src/ingest/pipeline";
import { PCE_EXPENDITURE_LINES } from "../src/lib/pce-expenditure";

async function main() {
  if (!process.env.BEA_API_KEY) throw new Error("BEA_API_KEY is required");
  const params = new URLSearchParams({ UserID: process.env.BEA_API_KEY, method: "GetData", DataSetName: "NIPA", TableName: "T20805", Frequency: "M", Year: "ALL", ResultFormat: "JSON" });
  const response = await fetch(`https://apps.bea.gov/api/data?${params}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`BEA request failed: HTTP ${response.status}`);
  const payload = await response.json() as { BEAAPI?: { Results?: { Data?: Array<{ LineNumber?: string; TimePeriod?: string; DataValue?: string }> } } };
  const data = payload.BEAAPI?.Results?.Data;
  if (!Array.isArray(data) || !data.length) throw new Error("BEA returned no expenditure observations");
  const byLine = new Map(Object.entries(PCE_EXPENDITURE_LINES).map(([id, line]) => [String(line), id]));
  const points = new Map<string, { id: string; date: string; value: number }>();
  for (const row of data) {
    const id = byLine.get(String(row.LineNumber));
    const match = row.TimePeriod?.match(/^(\d{4})M(0[1-9]|1[0-2])$/);
    const raw = row.DataValue?.replace(/,/g, "") ?? "";
    if (!id || !match || !/^-?\d+(?:\.\d+)?$/.test(raw)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    const date = `${match[1]}-${match[2]}-01`;
    points.set(`${id}:${date}`, { id, date, value });
  }
  const ids = Object.keys(PCE_EXPENDITURE_LINES);
  for (const id of ids) if (![...points.values()].some(point => point.id === id)) throw new Error(`BEA response lacks required input ${id}`);
  await ensureSchema();
  await seedCatalog({ metricIds: ids, cleanupOrphans: false });
  const client = getClient();
  const statements = [...points.values()].map(point => ({
    sql: "INSERT INTO observations (metric_id,date,value,raw_value,vintage_date,is_latest) SELECT ?,?,?,?,NULL,1 WHERE NOT EXISTS (SELECT 1 FROM observations WHERE metric_id = ? AND date = ?)",
    args: [point.id, point.date, point.value, point.value, point.id, point.date],
  }));
  let inserted = 0;
  for (let offset = 0; offset < statements.length; offset += 200) {
    const results = await client.batch(statements.slice(offset, offset + 200), "write");
    inserted += results.reduce((sum, result) => sum + result.rowsAffected, 0);
  }
  console.log(`BEA PCE expenditure inputs: ${points.size} official observations inspected; ${inserted} missing observations inserted across ${ids.length} series.`);
  client.close();
}
main().catch(error => { console.error("PCE expenditure backfill failed:", error instanceof Error ? error.message : "unknown error"); process.exitCode = 1; });
