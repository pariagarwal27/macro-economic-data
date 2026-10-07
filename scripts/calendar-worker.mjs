import { spawn } from 'node:child_process';
import { CalendarRefreshScheduler } from './calendar-refresh-scheduler.mjs';
import dotenv from 'dotenv';

dotenv.config({path:['.env.local','.env'],quiet:true});

let child;
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
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(signal); });
console.log('[calendar-worker] Weekly refresh enabled; checks on startup and every minute, retries failures after one hour.');
do {
  try {
    const outcome = await scheduler.tick();
    if (outcome !== 'not-due') console.log(`[calendar-worker] ${outcome}`);
  } catch (error) { console.error('[calendar-worker]', error.message); }
  if (!stopping && process.env.CALENDAR_RUN_ONCE !== '1') await new Promise(resolve => {
    const stop = () => { clearTimeout(timer); process.off('SIGTERM', stop); process.off('SIGINT', stop); resolve(); };
    const timer = setTimeout(stop, 60_000);
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  });
} while (!stopping && process.env.CALENDAR_RUN_ONCE !== '1');
