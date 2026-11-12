import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  if (!process.env.BEA_API_KEY) throw new Error("BEA_API_KEY is required");
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
    throw new Error("This repair only backfills the local dashboard database.");
  }

  const { PCE_COMPONENTS } = await import("../src/ingest/us-inflation");
  const { PCE_EXPENDITURE_LINES } = await import("../src/lib/pce-expenditure");
  const { runIngest } = await import("../src/ingest/pipeline");
  const { ensureSchema, seedCatalog } = await import("../src/ingest/pipeline");
  const { getClient } = await import("../src/db");

  const priceIds = [...PCE_COMPONENTS.map(([id]) => id), "us-pce-housing", "us-core-pce-ex-housing"];
  const expenditureIds = Object.keys(PCE_EXPENDITURE_LINES);
  const ids = [...new Set([...priceIds, ...expenditureIds])];

  await ensureSchema();
  await seedCatalog({ metricIds: ids, cleanupOrphans: false });

  const priceSummary = process.argv.includes("--weights-only")
    ? { skipped: true, reason: "weights-only repair requested" }
    : await runIngest("backfill", { metricIds: priceIds });
  if ("failures" in priceSummary && (priceSummary.failures.length || priceSummary.metricsProcessed !== priceIds.length)) {
    throw new Error(`BEA price-index history backfill incomplete: ${JSON.stringify(priceSummary.failures)}`);
  }

  // T20805 is fetched once by line in the existing backfill because each item
  // is published in the same official NIPA table, preserving existing rows.
  const params = new URLSearchParams({
    UserID: process.env.BEA_API_KEY,
    method: "GetData",
    DataSetName: "NIPA",
    TableName: "T20805",
    Frequency: "M",
    Year: "ALL",
    ResultFormat: "JSON",
  });
  const response = await fetch(`https://apps.bea.gov/api/data?${params}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`BEA T20805 request failed: HTTP ${response.status}`);
  const payload = await response.json() as { BEAAPI?: { Results?: { Data?: Array<{ LineNumber?: string; TimePeriod?: string; DataValue?: string }> } } };
  const data = payload.BEAAPI?.Results?.Data;
  if (!Array.isArray(data) || !data.length) throw new Error("BEA returned no T20805 observations");
  const lineToId = new Map(Object.entries(PCE_EXPENDITURE_LINES).map(([id, line]) => [String(line), id]));
  const points = new Map<string, { id: string; date: string; value: number }>();
  for (const row of data) {
    const id = lineToId.get(String(row.LineNumber));
    const period = row.TimePeriod?.match(/^(\d{4})M(0[1-9]|1[0-2])$/);
    const raw = row.DataValue?.replace(/,/g, "") ?? "";
    if (!id || !period || !/^-?\d+(?:\.\d+)?$/.test(raw)) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) points.set(`${id}:${period[1]}-${period[2]}-01`, { id, date: `${period[1]}-${period[2]}-01`, value });
  }
  for (const id of expenditureIds) {
    if (![...points.values()].some(point => point.id === id)) throw new Error(`BEA T20805 has no observations for ${id}`);
  }

  const client = getClient();
  let expenditureUpdated = 0;
  let expenditureInserted = 0;
  const rows = [...points.values()];
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).flatMap(point => [
      {
        sql: "UPDATE observations SET value = ?, raw_value = ?, is_latest = 1 WHERE metric_id = ? AND date = ? AND vintage_date IS NULL",
        args: [point.value, point.value, point.id, point.date],
      },
      {
        sql: "INSERT INTO observations (metric_id,date,value,raw_value,vintage_date,is_latest) SELECT ?,?,?,?,NULL,1 WHERE NOT EXISTS (SELECT 1 FROM observations WHERE metric_id = ? AND date = ? AND vintage_date IS NULL)",
        args: [point.id, point.date, point.value, point.value, point.id, point.date],
      },
    ]);
    const results = await client.batch(batch, "write");
    for (let j = 0; j < results.length; j += 2) {
      expenditureUpdated += results[j].rowsAffected;
      expenditureInserted += results[j + 1].rowsAffected;
    }
  }

  const coverage = await client.execute({
    sql: `SELECT metric_id, COUNT(*) AS observations, MIN(date) AS first_period, MAX(date) AS latest_period FROM observations WHERE metric_id IN (${ids.map(() => "?").join(",")}) GROUP BY metric_id ORDER BY metric_id`,
    args: ids,
  });
  const byId = new Map(coverage.rows.map(row => [String(row.metric_id), row]));
  const missing = ids.filter(id => !byId.has(id) || Number(byId.get(id)?.observations) < 6);
  console.log(JSON.stringify({
    source: "BEA NIPA Tables 2.8.4 (price indexes) and 2.8.5 (current-dollar expenditures)",
    priceSummary,
    expenditureRowsInspected: points.size,
    expenditureUpdated,
    expenditureInserted,
    coverage: coverage.rows,
    missingOrInsufficient: missing,
  }, null, 2));
  client.close();
  if (missing.length) throw new Error(`PCE component history still missing for: ${missing.join(", ")}`);
}

main().catch(error => {
  console.error("PCE card backfill failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
