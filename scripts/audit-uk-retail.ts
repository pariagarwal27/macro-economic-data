import { getClient } from '../src/db';
import { fetchOnsSeries } from '../src/ingest/ons';
import { METRICS } from '../src/catalog/metrics';
import { UK_RETAIL_RELEASE_IDS } from '../src/lib/uk-retail';
import { runIngest } from '../src/ingest/pipeline';
async function main() {
  if (process.argv.includes('--refresh')) {
    const summary = await runIngest('refresh', { metricIds: UK_RETAIL_RELEASE_IDS });
    console.log(JSON.stringify(summary));
    if (summary.failures.length) throw new Error('Retail refresh failed');
  }
  const client = getClient();
  for (const id of UK_RETAIL_RELEASE_IDS) {
    const metric = METRICS.find(m => m.id === id)!;
    const stored = await client.execute({sql: 'SELECT date,value,released_at FROM observations WHERE metric_id = ? AND is_latest = 1 ORDER BY date DESC LIMIT 1', args: [id]});
    console.log(JSON.stringify({id, stored: stored.rows[0]}));
    if (process.argv.includes('--fetch')) {
      try {
        const points = await fetchOnsSeries(metric.seriesId);
        console.log(JSON.stringify({id, official: points.at(-1), count: points.length}));
      } catch (error) { console.error(id, String(error)); }
    }
  }
  client.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
