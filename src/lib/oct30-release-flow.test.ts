import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleaseOpenings, enqueueReleaseOpenings, mergeReleaseUpdates } from './release-notifications';

test('all four October 30 publications update visible history and queue their owning cards once', () => {
  const ids = ['uk-dmp-own-price-exp-1y','uk-dmp-wage-exp-1y','ea-unemployment','ea-youth-unemployment'];
  const releasedAt = '2026-10-30T10:00:01Z';
  const updates = ids.map((metricId,id) => ({id:id+1,metricId,periodDate:'2026-10-01',releasedAt,value:id+3,stage:null}));
  const existing = Object.fromEntries(ids.map(id=>[id,{history:[{date:'2026-09-01',value:2}],displayReleasedAt:'2026-09-30T10:00:00Z'}]));
  const merged = mergeReleaseUpdates(existing,updates);
  for (const update of updates) {
    assert.deepEqual(merged[update.metricId].history.at(-1),{date:update.periodDate,value:update.value});
    assert.equal(merged[update.metricId].displayReleasedAt,releasedAt);
  }
  const openings = buildReleaseOpenings(updates,Date.parse(releasedAt));
  const seen = new Set<string>();
  const queue = enqueueReleaseOpenings([],openings,seen);
  assert.deepEqual(queue.map(o=>o.metricId),['uk-dmp-inflation-exp-1y','uk-dmp-wage-exp-1y','ea-unemployment','ea-youth-unemployment']);
  assert.equal(enqueueReleaseOpenings(queue,openings,seen).length,4);
});
