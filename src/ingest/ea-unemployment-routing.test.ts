import assert from 'node:assert/strict';
import test from 'node:test';
import { getSourceConfig, getCloudSourceConfig, getActiveLiveSource, SOURCE_REGISTRY } from './source-registry';
import { fetchEurostatPreset } from './eurostat';

test('euro-area unemployment uses official Eurostat in local and cloud release workers', () => {
  for (const config of [getSourceConfig('ea-unemployment'),getCloudSourceConfig('ea-unemployment')]) {
    assert.equal(config?.adapter,'pipeline');
    assert.equal(config?.source,'eurostat');
    assert.equal(config?.sourceId,'une_rt_m');
  }
  assert.equal(getActiveLiveSource('ea-unemployment',false),'eurostat');
  assert.equal(SOURCE_REGISTRY.filter(c=>c.metricId==='ea-unemployment').length,1);
});

test('official unemployment requests the seasonally adjusted total Euro-area rate afresh', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname,'ec.europa.eu');
    assert.ok(url.pathname.endsWith('/une_rt_m'));
    for (const [key,value] of Object.entries({geo:'EA21',sex:'T',age:'TOTAL',s_adj:'SA',unit:'PC_ACT'})) assert.equal(url.searchParams.get(key),value);
    requests++;
    return Response.json({id:['time'],size:[1],dimension:{time:{category:{index:{'2026-09':0}}}},value:{'0':requests===1?6.4:6.3}});
  };
  try {
    assert.deepEqual(await fetchEurostatPreset('une_rt_m'),[{date:'2026-09-01',value:6.4,releaseStage:undefined}]);
    assert.deepEqual(await fetchEurostatPreset('une_rt_m'),[{date:'2026-09-01',value:6.3,releaseStage:undefined}]);
    assert.equal(requests,2);
    const { fetchMetricFromOfficialSource } = await import('./source-adapter');
    const result = await fetchMetricFromOfficialSource('ea-unemployment');
    assert.equal(result?.periodDate,'2026-09-01');
    assert.equal(result?.value,6.3);
    assert.ok(requests > 2,'The release adapter must call Eurostat directly');
  } finally { globalThis.fetch = original; }
});
