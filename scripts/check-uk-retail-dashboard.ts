import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/dashboard/[region]/route';
import { getClient } from '../src/db';
import { UK_RETAIL_RELEASE_IDS } from '../src/lib/uk-retail';

async function main() {
  const response = await GET(new NextRequest('http://localhost/api/dashboard/UK'), { params: Promise.resolve({region:'UK'}) });
  assert.equal(response.status,200);
  type Point = { date: string; value: number };
  const payload = await response.json() as Record<string, { history: Point[]; threeMonth: { history: Point[] } }>;
  for (const id of UK_RETAIL_RELEASE_IDS.filter(id => id !== 'uk-retail-sales-mom')) {
    assert.ok(payload[id]?.history.length > 0, `${id}: frontend history missing`);
  }
  for (const id of ['uk-retail-sales-total-ex-fuel','uk-retail-sales-ex-fuel']) {
    const trendId = id === 'uk-retail-sales-total-ex-fuel' ? 'uk-retail-sales-total-3m3m' : 'uk-retail-sales-ex-fuel-3m3m';
    const actual = payload[id].threeMonth.history.at(-1);
    const expected = payload[trendId].history.at(-1);
    assert.ok(actual && expected, `${id}: latest trend missing`);
    assert.equal(actual.date,expected.date);
    assert.equal(actual.value,expected.value);
    console.log(JSON.stringify({id,latest:payload[id].history.at(-1),trend:actual}));
  }
  console.log('UK dashboard API includes all six published retail histories and both published three-month trends.');
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => getClient().close());
