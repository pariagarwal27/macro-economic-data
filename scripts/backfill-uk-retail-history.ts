import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getClient } from '../src/db';
import { parseOnsCsv } from '../src/ingest/ons-csv';
import { METRICS } from '../src/catalog/metrics';
import { UK_RETAIL_RELEASE_IDS } from '../src/lib/uk-retail';

// Use published SA volume growth rates, never derive rates from rounded rates.
const seriesById = Object.fromEntries(UK_RETAIL_RELEASE_IDS.map(id => [id, METRICS.find(m => m.id === id)!.seriesId]));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve('data', 'audits', `uk-retail-${stamp}`);

async function main() {
  await fs.mkdir(output, { recursive: true });
  const official = new Map<string, ReturnType<typeof parseOnsCsv>>();
  for (const series of new Set(Object.values(seriesById))) {
    const uri = `/businessindustryandtrade/retailindustry/timeseries/${series.toLowerCase()}/drsi`;
    const url = `https://www.ons.gov.uk/generator?format=csv&uri=${encodeURIComponent(uri)}`;
    let response: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      response = await fetch(url, { headers: { Accept: 'text/csv', 'User-Agent': 'macro-economy-tracker/1.0' }, signal: AbortSignal.timeout(60000) });
      if (response.status !== 429 && response.status < 500) break;
      const retrySeconds = Number(response.headers.get('retry-after'));
      await new Promise(resolve => setTimeout(resolve, Math.min(60000, Math.max(5000 * (attempt + 1), Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0))));
    }
    if (!response) throw new Error(`${series}: no response`);
    if (!response.ok) throw new Error(`${series}: HTTP ${response.status}`);
    const csv = await response.text();
    await fs.writeFile(path.join(output, `${series}.csv`), csv);
    assert.ok(csv.toUpperCase().includes(series), `${series}: wrong source response`);
    const points = parseOnsCsv(csv, true);
    assert.ok(points.length > 300, `${series}: unexpectedly short history`);
    assert.equal(new Set(points.map(p => p.date)).size, points.length, `${series}: duplicate months`);
    for (let i = 1; i < points.length; i++) {
      const prior = new Date(points[i - 1].date + 'T00:00:00Z');
      prior.setUTCMonth(prior.getUTCMonth() + 1);
      assert.equal(points[i].date, prior.toISOString().slice(0, 10), `${series}: missing month`);
    }
    official.set(series, points);
    console.log(`${series}: ${points.length} months, ${points[0].date} to ${points.at(-1)!.date}`);
  }
  const client = getClient();
  try {
    const ids = UK_RETAIL_RELEASE_IDS;
    const placeholders = ids.map(() => '?').join(',');
    const oldObservations = await client.execute({ sql: `SELECT * FROM observations WHERE metric_id IN (${placeholders}) ORDER BY metric_id,date,id`, args: ids });
    const oldMetrics = await client.execute({ sql: `SELECT * FROM metrics WHERE id IN (${placeholders})`, args: ids });
    const oldReleases = await client.execute({ sql: `SELECT * FROM releases WHERE metric_id IN (${placeholders})`, args: ids });
    await fs.writeFile(path.join(output, 'before.json'), JSON.stringify({ metrics: oldMetrics.rows, observations: oldObservations.rows, releases: oldReleases.rows }, null, 2));
    const report = ids.map(id => {
      const series = seriesById[id];
      const points = official.get(series)!;
      const expected = new Map(points.map(p => [p.date, p.value]));
      const stored = oldObservations.rows.filter(row => row.metric_id === id);
      const actual = new Map(stored.map(row => [String(row.date), Number(row.value)]));
      const changed = points.filter(p => actual.has(p.date) && actual.get(p.date) !== p.value).map(p => ({ date: p.date, stored: actual.get(p.date), official: p.value }));
      return { id, series, officialUrl: `https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/${series.toLowerCase()}/drsi`,
        count: points.length, first: points[0].date, latest: points.at(-1),
        changed, missing: points.filter(p => !actual.has(p.date)),
        extra: stored.filter(row => !expected.has(String(row.date))), duplicates: stored.length - actual.size,
        august2026: expected.get('2026-08-01') };
    });
    await fs.writeFile(path.join(output, 'comparison.json'), JSON.stringify(report, null, 2));
    if (process.argv.includes('--apply')) {
      const tx = await client.transaction('write');
      try {
        for (const item of report) {
          const points = official.get(item.series)!;
          await tx.execute({ sql: 'DELETE FROM observations WHERE metric_id = ?', args: [item.id] });
          for (let start = 0; start < points.length; start += 100) {
            const chunk = points.slice(start, start + 100);
            await tx.execute({ sql: `INSERT INTO observations (metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES ${chunk.map(() => '(?,?,?,?,?,?,1)').join(',')}`,
              args: chunk.flatMap(p => {
                const prior = oldObservations.rows.find(row => row.metric_id === item.id && row.date === p.date);
                return [item.id, p.date, p.value, p.value, prior?.released_at == null ? null : String(prior.released_at), `ons-audit-${stamp}`];
              }) });
          }
          await tx.execute({ sql: 'UPDATE metrics SET series_id=?,source=?,transform=?,earliest_available=?,observation_count=?,last_ingested_at=? WHERE id=?', args: [item.series, 'ons', 'published_rate', item.first, item.count, new Date().toISOString(), item.id] });
          const verified = await tx.execute({ sql: 'SELECT date,value FROM observations WHERE metric_id=? ORDER BY date', args: [item.id] });
          assert.deepEqual(verified.rows.map(row => ({ date: String(row.date), value: Number(row.value) })), points);
        }
        await tx.commit();
      } catch (error) { await tx.rollback(); throw error; }
      finally { tx.close(); }
    }
    const summary = { applied: process.argv.includes('--apply'), output, series: report.map(({ changed, missing, extra, ...item }) => ({ ...item, changed: changed.length, missing: missing.length, extra: extra.length })) };
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally { client.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
