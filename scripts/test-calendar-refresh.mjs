import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CalendarRefreshScheduler, acquireRefreshLock, hasElapsedCalendarRelease } from './calendar-refresh-scheduler.mjs';
import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(tmpdir(), 'calendar-refresh-test-'));
try {
  let runs = 0;
  const options = { statePath: path.join(root, 'state.json'), run: async () => { runs++; }, now: () => Date.parse('2026-10-07T12:00:00Z'), isReleaseDue: async () => false };
  const databasePath = path.join(root, 'calendar.db');
  const calendar = createClient({ url: `file:${databasePath.replace(/\\/g, '/')}` });
  await calendar.execute('CREATE TABLE calendar(status TEXT, next_release_date TEXT, next_release_at TEXT, release_deadline_at TEXT)');
  await calendar.execute("INSERT INTO calendar VALUES ('official_date', '2026-10-07', '2026-10-07T08:30:00-04:00', NULL)");
  calendar.close();
  assert.equal(await hasElapsedCalendarRelease({ databasePath, since: '2026-10-07T12:00:00Z', now: Date.parse('2026-10-07T12:29:00Z') }), false);
  assert.equal(await hasElapsedCalendarRelease({ databasePath, since: '2026-10-07T12:00:00Z', now: Date.parse('2026-10-07T12:31:00Z') }), true, 'Compare release instants across timezone offsets');
  assert.equal(await hasElapsedCalendarRelease({ databasePath, since: '2026-10-07T12:31:00Z', now: Date.parse('2026-10-07T13:00:00Z') }), false, 'A fetched publication must not trigger another refresh');
  const first = new CalendarRefreshScheduler(options);
  assert.equal(await first.tick(), 'refreshed');
  assert.equal(runs, 1);
  assert.equal(await new CalendarRefreshScheduler(options).tick(), 'not-due', 'Restart must retain the last success');
  const later = new CalendarRefreshScheduler({ ...options, now: () => options.now() + 86_400_001 });
  assert.equal(await later.tick(), 'refreshed', 'Refresh stale schedules daily, without waiting for next week');
  const afterRelease = new CalendarRefreshScheduler({ ...options,
    statePath: path.join(root, 'after-release.json'),
    isReleaseDue: async ({ since, now }) => Date.parse(since) < Date.parse('2026-10-07T13:30:00Z') && now >= Date.parse('2026-10-07T13:30:00Z'),
  });
  assert.equal(await afterRelease.tick(), 'refreshed');
  const followup = new CalendarRefreshScheduler({ ...options, statePath: path.join(root, 'after-release.json'),
    now: () => Date.parse('2026-10-07T14:00:00Z'), isReleaseDue: afterRelease.isReleaseDue,
  });
  const beforeFollowup = runs;
  assert.equal(await followup.tick(), 'refreshed', 'Roll the schedule forward after a publication instead of calling it unannounced');
  assert.equal(runs, beforeFollowup + 1);
  assert.equal(await followup.tick(), 'not-due', 'Do not repeatedly refresh a publication already checked');
  let release;
  const blocked = new CalendarRefreshScheduler({ ...options, statePath: path.join(root, 'blocked.json'), run: () => new Promise(resolve => { release = resolve; }) });
  const pending = blocked.tick();
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await blocked.tick(), 'busy', 'Do not overlap refreshes');
  const contender = new CalendarRefreshScheduler({ ...options, statePath: path.join(root, 'blocked.json') });
  assert.equal(await contender.tick(), 'busy', 'Other workers must honor the disk lock');
  release(); await pending;
  let attempts = 0;
  const failing = new CalendarRefreshScheduler({ ...options, statePath: path.join(root, 'failure.json'), run: async () => { attempts++; throw Error('provider unavailable'); } });
  assert.equal(await failing.tick(), 'failed');
  assert.equal(await failing.tick(), 'not-due', 'Back off instead of retrying every minute');
  const retry = new CalendarRefreshScheduler({ ...options, statePath: path.join(root, 'failure.json'), now: () => options.now() + 3_600_001 });
  assert.equal(await retry.tick(), 'refreshed', 'Failure must not advance the weekly success timestamp');
  const crashPath = path.join(root,'crash.json');
  const moduleUrl = pathToFileURL(path.resolve('scripts/calendar-refresh-scheduler.mjs')).href;
  const child = spawn(process.execPath,['--input-type=module','-e',`const {acquireRefreshLock}=await import(${JSON.stringify(moduleUrl)}); await acquireRefreshLock(${JSON.stringify(crashPath)}); process.send('locked'); setInterval(()=>{},1000);`],{stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error(`Lock owner exited early: ${code}`)));});
  assert.equal(await acquireRefreshLock(crashPath),null,'Another process must not overlap');
  const exited = new Promise(resolve=>child.once('exit',resolve)); child.kill('SIGKILL'); await exited;
  const contenders = await Promise.all(Array.from({length:8},()=>acquireRefreshLock(crashPath)));
  assert.equal(contenders.filter(Boolean).length,1,'Crash recovery must have exactly one winner');
  for(const unlock of contenders) if(unlock) await unlock();
  console.log('Daily and post-release refresh, restart catch-up, locks, and failure retry passed');
} finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()),'Cleanup must stay inside the test temp directory');
  await rm(root, { recursive: true, force: true, maxRetries:10, retryDelay:100 });
}
