import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CalendarRefreshScheduler, WEEK_MS, acquireRefreshLock } from './calendar-refresh-scheduler.mjs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(path.join(tmpdir(), 'calendar-refresh-test-'));
try {
  let runs = 0;
  const options = { statePath: path.join(root, 'state.json'), run: async () => { runs++; }, now: () => Date.parse('2026-10-07T12:00:00Z') };
  const first = new CalendarRefreshScheduler(options);
  assert.equal(await first.tick(), 'refreshed');
  assert.equal(runs, 1);
  assert.equal(await new CalendarRefreshScheduler(options).tick(), 'not-due', 'Restart must retain the last success');
  const later = new CalendarRefreshScheduler({ ...options, now: () => options.now() + WEEK_MS + 1 });
  assert.equal(await later.tick(), 'refreshed', 'Catch up after missing the weekly run');
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
  console.log('Weekly refresh, restart catch-up, locks, and failure retry passed');
} finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()),'Cleanup must stay inside the test temp directory');
  await rm(root, { recursive: true, force: true, maxRetries:10, retryDelay:100 });
}
