import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const refreshStatePath = () => process.env.CALENDAR_REFRESH_STATE_PATH ?? path.join(process.cwd(), 'data', 'calendar-refresh-state.json');
export async function readRefreshState(statePath) {
  try { return JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}
export async function saveRefreshState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, statePath);
}
export async function acquireRefreshLock(statePath) {
  await mkdir(path.dirname(statePath), { recursive: true });
  // This database is exclusively for coordination, so holding its transaction
  // never blocks dashboard reads or the actual calendar database loader.
  // SQLite's OS lock disappears on process death, irrespective of PID reuse.
  const client = createClient({url:`file:${path.resolve(`${statePath}.lock.db`).replace(/\\/g,'/')}`});
  try {
    await client.execute('PRAGMA busy_timeout=0');
    // Use this local client's connection directly, so close() also releases
    // the native file handle (important for Windows and long-lived workers).
    await client.execute('BEGIN IMMEDIATE');
    return async () => { try { await client.execute('ROLLBACK'); } finally { client.close(); } };
  } catch (error) {
    client.close();
    if (/SQLITE_BUSY|database is locked/i.test(String(error))) return null;
    throw error;
  }
}
export class CalendarRefreshScheduler {
  running = false;
  constructor({ statePath = refreshStatePath(), run, now = Date.now, onError = () => {} }) {
    this.statePath = statePath; this.run = run; this.now = now; this.onError = onError;
  }
  async tick() {
    if (this.running) return 'busy';
    this.running = true;
    let unlock;
    try {
      const now = this.now();
      unlock = await acquireRefreshLock(this.statePath);
      if (!unlock) return 'busy';
      // Re-read after taking the lock in case another process just finished.
      const latest = await readRefreshState(this.statePath);
      if (latest.lastSuccessAt && now - Date.parse(latest.lastSuccessAt) < WEEK_MS) return 'not-due';
      if (latest.lastAttemptAt && now - Date.parse(latest.lastAttemptAt) < 3_600_000) return 'not-due';
      const attempt = { ...latest, lastAttemptAt: new Date(now).toISOString() };
      await saveRefreshState(this.statePath, attempt);
      try {
        await this.run();
        await saveRefreshState(this.statePath, { ...attempt, lastSuccessAt: new Date(this.now()).toISOString(), lastError: null });
        return 'refreshed';
      } catch (error) {
        await saveRefreshState(this.statePath, { ...attempt, lastError: 'Calendar refresh failed; see server logs.' });
        this.onError(error);
        return 'failed';
      }
    } finally { if (unlock) await unlock(); this.running = false; }
  }
}
