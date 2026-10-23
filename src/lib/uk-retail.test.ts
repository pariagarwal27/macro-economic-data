import assert from 'node:assert/strict';
import test from 'node:test';
import { retailPublishedPoints, retailReleaseCandidates, isUkRetailReleasePeriod } from './uk-retail';

test('published MoM retains the new month independently of lagging YoY and preserves missing comparisons', () => {
  const headline = [{ date: '2026-08-01', value: 0.5 }, { date: '2026-09-01', value: -0.4 }];
  const exFuel = [{ date: '2026-08-01', value: 0.6 }];
  assert.deepEqual(retailPublishedPoints(headline, exFuel), [
    { date: '2026-08-01', headline: 0.5, exFuel: 0.6 },
    { date: '2026-09-01', headline: -0.4, exFuel: null },
  ]);
});

test('comparison-only months and zero readings are retained in chronological order', () => {
  assert.deepEqual(retailPublishedPoints([{ date: '2026-08-01', value: 0 }], [{ date: '2026-09-01', value: -0.2 }]), [
    { date: '2026-08-01', headline: 0, exFuel: null },
    { date: '2026-09-01', headline: null, exFuel: -0.2 },
  ]);
});

test('a due headline release schedules all published retail measures with the same release time', () => {
  const rows = [{ metricId: 'uk-retail-sales-total-ex-fuel', nextReleaseDate: '2026-10-23', nextReleaseAt: '2026-10-23T06:00:00Z' }];
  assert.equal(retailReleaseCandidates(rows, new Date('2026-10-23T05:59:00Z')).length, 0);
  const candidates = retailReleaseCandidates(rows, new Date('2026-10-23T06:01:00Z'));
  for (const id of ['uk-retail-sales-ex-fuel', 'uk-retail-sales-total-yoy', 'uk-retail-sales-ex-fuel-yoy', 'uk-retail-sales-total-3m3m', 'uk-retail-sales-ex-fuel-3m3m']) {
    assert.ok(candidates.some(candidate => candidate.metricId === id && candidate.scheduledAt === rows[0].nextReleaseAt));
  }
  assert.equal(retailReleaseCandidates(rows, new Date('2026-10-27T06:01:00Z')).length, 0);
});

test('local and hosted retail measures use the official ONS series', async () => {
  const { getSourceConfig, getCloudSourceConfig } = await import('../ingest/source-registry');
  for (const [id, series] of [
    ['uk-retail-sales-total-ex-fuel', 'J5EC'], ['uk-retail-sales-mom', 'J5EC'],
    ['uk-retail-sales-ex-fuel', 'J45W'], ['uk-retail-sales-total-yoy', 'J5EB'],
    ['uk-retail-sales-ex-fuel-yoy', 'J45U'], ['uk-retail-sales-total-3m3m', 'J5EG'],
    ['uk-retail-sales-ex-fuel-3m3m', 'J45R'],
  ]) {
    for (const config of [getSourceConfig(id), getCloudSourceConfig(id)]) {
      assert.equal(config?.source, 'ons');
      assert.equal(config?.sourceId, series);
      assert.equal(config?.adapter, 'pipeline');
    }
  }
});

test('rollover to next month still retries the whole previous retail release family', () => {
  const rows = [
    { metricId: 'uk-retail-sales-total-ex-fuel', nextReleaseDate: '2026-11-20', nextReleaseAt: '2026-11-20T07:00:00Z' },
    { metricId: 'uk-retail-sales-total-ex-fuel', nextReleaseDate: '2026-10-23', nextReleaseAt: '2026-10-23T06:00:00Z' },
  ];
  const candidates = retailReleaseCandidates(rows, new Date('2026-10-24T07:00:00Z'));
  assert.equal(candidates.length, 7);
  assert.ok(candidates.every(candidate => candidate.scheduledAt === '2026-10-23T06:00:00Z'));
});

test('release validation rejects last month stale data and handles January year rollover', () => {
  assert.equal(isUkRetailReleasePeriod('2026-10-23T06:00:00Z','2026-08-01'),false);
  assert.equal(isUkRetailReleasePeriod('2026-10-23T06:00:00Z','2026-09-01'),true);
  assert.equal(isUkRetailReleasePeriod('2027-01-22T07:00:00Z','2026-12-01'),true);
});

test('a stale independent comparison schedule cannot claim the release before the headline event', () => {
  const rows = [
    { metricId: 'uk-retail-sales-ex-fuel-yoy', nextReleaseDate: '2026-10-22', nextReleaseAt: '2026-10-22T06:00:00Z' },
    { metricId: 'uk-retail-sales-total-ex-fuel', nextReleaseDate: '2026-10-23', nextReleaseAt: '2026-10-23T06:00:00Z' },
  ];
  assert.equal(retailReleaseCandidates(rows, new Date('2026-10-23T05:00:00Z')).length, 0);
});
