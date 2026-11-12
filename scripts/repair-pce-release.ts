import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  if (!process.env.BEA_API_KEY) throw new Error("BEA_API_KEY required");
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) throw new Error("This repair is limited to the local dashboard database");
  const { METRICS } = await import("../src/catalog/metrics");
  const { getClient } = await import("../src/db");
  const { ensureSchema, seedCatalog } = await import("../src/ingest/pipeline");
  const { processFetchedRelease } = await import("../src/ingest/release-processor");
  const { persistPceHistoryRevisions } = await import("../src/ingest/pce-history");
  const { expectedPcePeriod, isPceMonthlySeries, pceRate } = await import("../src/lib/pce-release");
  const { applyTransform, round } = await import("../src/ingest/transforms");
  const { markReleaseProcessed, getPollState } = await import("../src/ingest/release-state");
  const { PCE_COMPONENTS } = await import("../src/ingest/us-inflation");
  const { pceReleaseRows } = await import("../src/lib/release-driver-adapters");
  const definitions = METRICS.filter(isPceMonthlySeries);
  type BeaRow = { LineNumber: string; TimePeriod: string; DataValue: string };
  const tables = new Map<string, BeaRow[]>();
  for (const table of ["T20804", "T20805"]) {
    const year = new Date().getUTCFullYear();
    const params = new URLSearchParams({ UserID: process.env.BEA_API_KEY, method: "GetData", DataSetName: "NIPA", TableName: table, Frequency: "M", Year: `${year - 1},${year}`, ResultFormat: "JSON" });
    const response = await fetch(`https://apps.bea.gov/api/data?${params}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`BEA ${table}: HTTP ${response.status}`);
    const payload = await response.json() as { BEAAPI?: { Results?: { Data?: BeaRow[] } } };
    const rows = payload.BEAAPI?.Results?.Data;
    if (!rows?.length) throw new Error(`BEA ${table} returned no observations`);
    tables.set(table, rows);
  }
  await ensureSchema();
  await getPollState();
  await seedCatalog({ metricIds: definitions.map(metric => metric.id), cleanupOrphans: false });
  const client = getClient();
  const states = (await client.execute("SELECT metric_id,scheduled_at FROM release_dispatch_state ORDER BY scheduled_at DESC")).rows;
  const snapshots: import("../src/lib/release-driver-adapters").ReleaseMetrics = {};
  const results = [];
  for (const metric of definitions) {
    const [table, line] = metric.seriesId.split(":");
    const raw = tables.get(table)!.filter(row => row.LineNumber === line).flatMap(row => {
      const period = row.TimePeriod.match(/^(\d{4})M(\d{2})$/);
      const value = Number(row.DataValue.replace(/,/g, ""));
      return period && Number.isFinite(value) ? [{ date: `${period[1]}-${period[2]}-01`, value }] : [];
    });
    const history = applyTransform(raw, metric.transform).map(point => ({ ...point, value: round(point.value) }));
    const latest = history.at(-1);
    if (!latest) throw new Error(`No BEA history for ${metric.id}`);
    snapshots[metric.id] = { meta: metric, history };
    await persistPceHistoryRevisions(metric.id, history);
    const state = states.find(row => row.metric_id === metric.id && expectedPcePeriod(String(row.scheduled_at)) === latest.date && Date.parse(String(row.scheduled_at)) <= Date.now());
    const scheduledAt = state ? String(state.scheduled_at) : undefined;
    const result = await processFetchedRelease({ metricId: metric.id, scheduledAt, result: { periodDate: latest.date, value: latest.value, rawValue: latest.rawValue, note: "BEA PCE repair: rates and revisions from one current NIPA table snapshot" } });
    const release = await client.execute({ sql: "SELECT id FROM releases WHERE metric_id=? AND period_date=? AND value=? ORDER BY released_at DESC,id DESC LIMIT 1", args: [metric.id, latest.date, latest.value] });
    if (scheduledAt && release.rows[0]) await markReleaseProcessed(metric.id, scheduledAt, Number(release.rows[0].id));
    results.push({ metricId: metric.id, period: latest.date, value: latest.value, observationsInSnapshot: history.length, status: result.reason });
  }
  const coreNodes = PCE_COMPONENTS.filter(([id]) => !["us-pce-food", "us-pce-energy"].includes(id)).map(([id, label]) => ({ id, label, metricId: id === "us-pce-housing-utilities" ? "us-pce-housing" : id }));
  const latestPeriod = snapshots["us-core-pce"]!.history.at(-1)!.date.slice(0, 7);
  console.log(JSON.stringify({ repaired: results, comparison: ["2026-08", latestPeriod].map(period => ({ period, coreMom: pceRate(snapshots, true, period, "mom"), estimatedComponentNet: pceReleaseRows(coreNodes, snapshots, period, "mom", true).reduce((sum, row) => sum + (row.current ?? 0), 0) })), latestRates: Object.fromEntries([false, true].flatMap(core => ["mom", "yoy"].map(mode => [`${core ? "core" : "headline"}_${mode}`, pceRate(snapshots, core, latestPeriod, mode as "mom" | "yoy")])) ) }, null, 2));
  client.close();
}

main().catch(error => { console.error(error instanceof Error ? error.message : "PCE repair failed"); process.exitCode = 1; });
