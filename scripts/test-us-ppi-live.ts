import assert from 'node:assert/strict';
import { fetchBlsSeries } from '../src/ingest/bls';
import { US_PPI_SERIES } from '../src/catalog/us-ppi.mjs';
import { withFreshReleaseFetch } from '../src/ingest/release-fetch-context.js';

async function main() {
const originalFetch = globalThis.fetch;
const batches: string[][] = [];
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body));
  batches.push(body.seriesid);
  return new Response(JSON.stringify({ status: 'REQUEST_SUCCEEDED', Results: { series: body.seriesid.map((seriesID: string) => ({ seriesID,
    data: [ { year: '2026', period: 'M09', value: '105' }, { year: '2026', period: 'M08', value: '100' }, { year: '2025', period: 'M09', value: '98' }, { year: '2025', period: 'M13', value: '99' } ],
  })) } }), { status: 200 });
};
try {
  const headline = await withFreshReleaseFetch(() => fetchBlsSeries(['WPUFD4'], { startYear: 2025, endYear: 2026 }));
  const count = batches.length;
  await withFreshReleaseFetch(() => fetchBlsSeries(['WPSFD41'], { startYear: 2025, endYear: 2026 }));
  assert.equal(batches.length, count, 'the next PPI component must share the release-family response, not call the API again');
  const requested = new Set(batches.flat());
  for (const series of US_PPI_SERIES) {
    assert.ok(requested.has(series.seriesId));
    assert.ok(requested.has(series.saSeriesId));
  }
  assert.ok(headline.get('WPUFD4')?.every(point => !point.date.includes('-13-')), 'M13 annual averages must never enter monthly PPI calculations');
} finally { globalThis.fetch = originalFetch; }
console.log('US PPI release fetches are batched and monthly observations exclude annual averages.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
