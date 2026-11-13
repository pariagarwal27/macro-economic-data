import { spawn } from 'node:child_process';
import { CalendarRefreshScheduler } from './calendar-refresh-scheduler.mjs';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({path:['.env.local','.env'],quiet:true});

let child;
let consensusChild;
let stopping = false;
const scheduler = new CalendarRefreshScheduler({
  run: () => new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['scripts/refresh-calendar.mjs'], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, CALENDAR_REFRESH_LOCK_HELD: '1' },
    });
    child.once('error', reject);
    child.once('exit', code => { child = null; code === 0 ? resolve() : reject(Error(`Calendar refresh exited ${code}`)); });
  }),
  onError: error => console.error('[calendar-worker]', error.message),
});
// ShowMyTrades provides a public economic-calendar API without an API key.
const consensusScheduler = new CalendarRefreshScheduler({
  statePath: process.env.SHOWMYTRADES_CONSENSUS_REFRESH_STATE_PATH ?? path.join(process.cwd(), 'data', 'showmytrades-consensus-refresh-state.json'),
  isReleaseDue: async () => false,
  retryIntervalMs: 24 * 60 * 60 * 1000,
  run: () => new Promise((resolve, reject) => {
    consensusChild = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/refresh-showmytrades.ts'], { stdio: 'inherit', windowsHide: true, env: { ...process.env } });
    consensusChild.once('error', reject);
    consensusChild.once('exit', code => { consensusChild = null; code === 0 ? resolve() : reject(Error(`ShowMyTrades consensus refresh exited ${code}`)); });
  }),
  onError: error => console.error('[showmytrades-worker]', error.message),
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(signal); consensusChild?.kill(signal); });
console.log('[calendar-worker] Daily and post-release schedule refresh enabled; checks every minute. ShowMyTrades consensus retries at most once daily.');
do {
  try {
    const outcome = await scheduler.tick();
    if (outcome !== 'not-due') console.log(`[calendar-worker] ${outcome}`);
  } catch (error) { console.error('[calendar-worker]', error.message); }
  if (!stopping) {
    try {
      const outcome = await consensusScheduler.tick();
      if (outcome !== 'not-due') console.log(`[showmytrades-worker] ${outcome}`);
    } catch (error) { console.error('[showmytrades-worker]', error.message); }
  }
  if (!stopping && process.env.CALENDAR_RUN_ONCE !== '1') await new Promise(resolve => {
    const stop = () => { clearTimeout(timer); process.off('SIGTERM', stop); process.off('SIGINT', stop); resolve(); };
    const timer = setTimeout(stop, 60_000);
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  });
} while (!stopping && process.env.CALENDAR_RUN_ONCE !== '1');
