import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeNfpStoredHistory } from './nfp-stored-history';

test('adds stored observations missing from releases without replacing release records or using future imports', () => {
  const rows = mergeNfpStoredHistory(
    [{metricId:'us-adp-change', periodDate:'2026-10-01', releasedAt:'2026-11-01T00:00:00Z', value:100}],
    [{metricId:'us-adp-change', periodDate:'2026-10-01', releasedAt:'2026-11-02T00:00:00Z', value:110},
     {metricId:'us-adp-change', periodDate:'2026-09-01', releasedAt:'2026-11-02T00:00:00Z', value:90},
     {metricId:'us-adp-change', periodDate:'2026-11-01', releasedAt:'2026-12-05T00:00:00Z', value:120}],
    '2026-12-03T00:00:00Z');
  assert.deepEqual(rows.map(x => x.value), [100, 90]);
});
