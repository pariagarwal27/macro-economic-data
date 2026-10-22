import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { US_PPI_SERIES, US_PPI_METRIC_IDS } from '../src/catalog/us-ppi.mjs';

async function main() {
  dotenv.config({ path: ['.env.local', '.env'], quiet: true });
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:')) {
    throw new Error('This repair only operates on the local dashboard SQLite database.');
  }
  const { fetchUsPpiHistory } = await import('../src/ingest/bls');
  // Validate every upstream series before changing any persisted PPI data.
  for (const series of US_PPI_SERIES) {
    for (const id of [series.seriesId, series.saSeriesId]) {
      const points = await fetchUsPpiHistory(id);
      if (points.length < 132) throw new Error(`${id}: only ${points.length} monthly index values; ten-year YoY backfill requires a full baseline.`);
    }
  }
  const { getClient } = await import('../src/db');
  const client = getClient();
  const backupDir = path.join(process.cwd(), 'data', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `macro-before-us-ppi-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  await client.execute({ sql: 'VACUUM INTO ?', args: [backup] });
  console.log(`Database backup: ${backup}`);
  // The two old headline mappings pointed at different BLS aggregates.
  // Remove only PPI release records so those old values cannot enter charts.
  await client.execute({ sql: `DELETE FROM releases WHERE metric_id IN (${US_PPI_METRIC_IDS.map(() => '?').join(',')})`, args: US_PPI_METRIC_IDS });
  const { runIngest } = await import('../src/ingest/pipeline');
  const summary = await runIngest('backfill', { metricIds: US_PPI_METRIC_IDS });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length || summary.metricsProcessed !== US_PPI_METRIC_IDS.length) throw new Error('US PPI backfill was incomplete; see the per-series failures above.');
  const coverage = await client.execute({ sql: `SELECT metric_id, COUNT(*) AS observations, MIN(date) AS first_period, MAX(date) AS latest_period FROM observations WHERE metric_id IN (${US_PPI_METRIC_IDS.map(() => '?').join(',')}) GROUP BY metric_id`, args: US_PPI_METRIC_IDS });
  if (coverage.rows.some(row => Number(row.observations) < 120)) throw new Error('A PPI rate series has less than ten years of observations.');
  const report = { generatedAt: new Date().toISOString(), source: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', summary, coverage: coverage.rows, backup };
  fs.writeFileSync(path.join(process.cwd(), 'data', 'us-ppi-backfill-report.json'), JSON.stringify(report, null, 2));
  console.log(`Verified ${coverage.rows.length} PPI rate series with at least 120 monthly observations each.`);
  client.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
