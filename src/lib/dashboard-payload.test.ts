import assert from 'node:assert/strict';
import test from 'node:test';
import { compactDashboardPayload } from './dashboard-payload';

test('retains every chart point, trend, release reading and metadata without shipping database-only fields', () => {
  const metric = {
    meta: { id: 'us-cpi', name: 'CPI', liveSource: 'BLS' },
    history: [{ date: '2026-09-01', value: 3, id: 123, metricId: 'us-cpi', rawValue: 300, vintageDate: '2026-10-01', releasedAt: null, isLatest: true }],
    releases: [{ periodDate: '2026-09-01', releasedAt: '2026-10-01', value: 3, periodLabel: 'September', notes: 'internal'.repeat(1000), supportingDocUrl: 'source' }],
    threeMonth: { history: [{ date: '2026-09-01', value: 2.8 }] },
    expectedValue: 3.1,
  };
  const result = compactDashboardPayload({ 'us-cpi': metric });
  assert.deepEqual(result['us-cpi'].history, [{ date: '2026-09-01', value: 3 }]);
  assert.deepEqual(result['us-cpi'].meta, metric.meta);
  assert.deepEqual(result['us-cpi'].threeMonth, metric.threeMonth);
  assert.deepEqual(result['us-cpi'].releases, [{ periodDate: '2026-09-01', releasedAt: '2026-10-01', value: 3, periodLabel: 'September' }]);
  assert.equal(result['us-cpi'].expectedValue, 3.1);
  assert.ok(JSON.stringify(result).length < JSON.stringify(metric).length / 5);
});
