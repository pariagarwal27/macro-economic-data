import { loadEnvConfig } from '@next/env';
import { getEconomicCalendarRows } from '../src/lib/economic-calendar-db';
import { getSourceConfig, getActiveLiveSource } from '../src/ingest/source-registry';
import { dashboardReleaseTarget, buildReleaseOpenings, enqueueReleaseOpenings } from '../src/lib/release-notifications';
import assert from 'node:assert/strict';
loadEnvConfig(process.cwd());
async function main() {
  const ids = ['uk-dmp-own-price-exp-1y','uk-dmp-wage-exp-1y','ea-unemployment','ea-youth-unemployment'];
  const rows = await getEconomicCalendarRows();
  for (const id of ids) {
    const row = rows.find(r => r.metricId === id);
    const target = dashboardReleaseTarget(id);
    assert.ok(row, id); assert.ok(target, id);
    console.log(JSON.stringify({id, at:row.nextReleaseAt, date:row.nextReleaseDate, timeKind:row.releaseTimeKind, config:getSourceConfig(id), activeSource:getActiveLiveSource(id,false), target}));
  }
  const now = Date.now();
  const openings = enqueueReleaseOpenings([],buildReleaseOpenings(ids.map((metricId,id)=>({id:id+1,metricId,periodDate:'2026-10-01',releasedAt:new Date(now).toISOString(),stage:null,value:3.5})),now),new Set());
  console.log('Queued owning cards:', openings.map(o=>o.metricId));
  for (const url of ['http://localhost:3000/api/economic-calendar', `${process.env.LSEG_WORKER_URL ?? 'http://127.0.0.1:8787'}/latest?ric=EUUNR%3DECI`]) {
    try { const r = await fetch(url,{signal:AbortSignal.timeout(7000)}); console.log(url, r.status, (await r.text()).slice(0,250)); }
    catch(e) { console.log(url, String(e)); }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
