import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

async function main() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'calendar-release-flow-'));
  process.env.DATABASE_URL = `file:${path.join(temporary,'macro.db').replace(/\\/g,'/')}`;
  process.env.CALENDAR_DB_PATH = path.join(temporary,'calendar.db');
  const { createClient } = await import('@libsql/client');
  const calendar = createClient({url:`file:${process.env.CALENDAR_DB_PATH.replace(/\\/g,'/')}`});
  const appRequire = createRequire(path.join(process.cwd(),'scripts/test-calendar-release-flow.ts'));
  const { ensureSchema, seedCatalog } = appRequire('../src/ingest/pipeline');
  const { getClient } = appRequire('../src/db');
  try {
    await ensureSchema(); await seedCatalog();
    await calendar.execute(`CREATE TABLE calendar(metric_id TEXT PRIMARY KEY,metric TEXT,source TEXT,family TEXT,next_release_date TEXT,next_release_at TEXT,status TEXT,official_source TEXT,official_evidence TEXT,updated_at TEXT)`);
    const scheduledAt = new Date(Date.now()-3_600_000).toISOString();
    await calendar.execute({sql:"INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?)",args:['us-cpi-yoy','CPI YoY','BLS','CPI',scheduledAt.slice(0,10),scheduledAt,'official_date','https://www.bls.gov/cpi/',null,new Date().toISOString()]});
    const { GET } = appRequire('../src/app/api/economic-calendar/route');
    const { NextRequest } = await import('next/server');
    const read = async () => {
      const response = await GET(new NextRequest('http://localhost/api/economic-calendar'));
      assert.equal(response.status,200);
      return response.json();
    };
    let payload = await read();
    assert.equal(payload.allEvents.find((event:{metricId:string})=>event.metricId==='us-cpi-yoy').status,'pending');
    const { claimRelease, getReleaseAttempt, markReleaseProcessed, markReleaseRetry } = appRequire('../src/ingest/release-state');
    const { processFetchedRelease } = appRequire('../src/ingest/release-processor');
    assert.equal(await claimRelease('us-cpi-yoy',scheduledAt),true);
    const firstAttempt = await getReleaseAttempt('us-cpi-yoy',scheduledAt);
    assert.equal(firstAttempt.attempt,1,'The first source fetch must be logged as attempt 1');
    assert.ok(firstAttempt.startedAt, 'The worker log attempt timestamp must come from the claimed dispatch record');
    await markReleaseRetry('us-cpi-yoy',scheduledAt,'First fetch had not yet published a new value.');
    assert.equal(await claimRelease('us-cpi-yoy',scheduledAt),true,'A completed failed attempt is immediately retryable');
    assert.equal((await getReleaseAttempt('us-cpi-yoy',scheduledAt)).attempt,2,'The next log must be numbered attempt 2');
    const committed = await processFetchedRelease({metricId:'us-cpi-yoy',result:{periodDate:'2026-09-01',value:3.4,rawValue:330,releasedAt:new Date(Date.now()-86_400_000).toISOString()}});
    assert.equal(committed.updated,true);
    assert.ok('releaseId' in committed && committed.releaseId);
    await markReleaseProcessed('us-cpi-yoy',scheduledAt,'releaseId' in committed ? committed.releaseId : null);
    payload = await read();
    const event = payload.allEvents.find((event:{metricId:string})=>event.metricId==='us-cpi-yoy');
    assert.equal(event.status,'released'); assert.equal(event.actual,3.4);
    const unchanged = await processFetchedRelease({metricId:'us-cpi-yoy',result:{periodDate:'2026-09-01',value:3.4}});
    assert.equal(unchanged.updated,false,'Unchanged source data must not create a new release');
    const refreshedAt = new Date().toISOString();
    await getClient().execute({
      sql:"INSERT INTO releases(metric_id,period_date,released_at,value) VALUES(?,?,?,?)",
      args:['us-cpi-yoy','2026-09-01',refreshedAt,3.4],
    });
    const alreadyRecorded = await processFetchedRelease({
      metricId:'us-cpi-yoy', scheduledAt,
      result:{periodDate:'2026-09-01',value:3.4,releasedAt:refreshedAt},
    });
    assert.equal(alreadyRecorded.updated,false);
    assert.equal(alreadyRecorded.reason,'already-recorded','An unchanged value recorded after this scheduled release completes its retry');
    assert.ok('releaseId' in alreadyRecorded && alreadyRecorded.releaseId);
    console.log('Real SQLite → committed release ID → calendar API Pending-to-Released flow passed');
  } finally {
    calendar.close(); getClient().close();
    assert.equal(path.dirname(path.resolve(temporary)),path.resolve(tmpdir()),'Cleanup must stay in the temporary test directory');
    await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
