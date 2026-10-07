import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";
import { acquireRefreshLock, refreshStatePath, readRefreshState, saveRefreshState } from './calendar-refresh-scheduler.mjs';

dotenv.config({path:['.env.local','.env'],quiet:true});

const root = process.cwd();
const secrets = {};
for (const file of [".env", ".env.local"]) {
  try { Object.assign(secrets, dotenv.parse(readFileSync(file))); } catch { /* Optional environment file. */ }
}
const env = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" };
for (const key of ["FRED_API_KEY", "BEA_API_KEY", "BLS_API_KEY", "CENSUS_API_KEY"]) if (!env[key] && secrets[key]) env[key] = secrets[key];
const redact = chunk => {
  let value = chunk.toString();
  for (const secret of [...Object.values(secrets), ...['FRED_API_KEY', 'BEA_API_KEY', 'BLS_API_KEY', 'CENSUS_API_KEY'].map(key=>env[key])]) if (secret?.length > 6) value = value.replaceAll(secret, "[redacted]");
  return value.replace(/((?:api_key|registrationkey|token|apikey)=)[^&\s]+/gi, "$1[redacted]");
};
const statePath = refreshStatePath();
const unlock = process.env.CALENDAR_REFRESH_LOCK_HELD === '1' ? async () => {} : await acquireRefreshLock(statePath);
if (!unlock) { console.log('[calendar-refresh] Another refresh is already running.'); process.exitCode = 2; }
else {
  let child;
  const stop = signal => child?.kill(signal);
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const seedPath = path.join(root, 'Economic_calendar', 'economic_calendar.db');
    const dbPath = path.resolve(process.env.CALENDAR_DB_PATH ?? seedPath);
    mkdirSync(path.dirname(dbPath), { recursive: true });
    if (!existsSync(dbPath) && dbPath !== seedPath && existsSync(seedPath)) copyFileSync(seedPath, dbPath);
    env.CALENDAR_DB_PATH = dbPath;
    const exported = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/export-calendar-catalog.ts'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (exported.status !== 0) throw Error('Could not export the authoritative dashboard catalog');
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.env.PYTHON_COMMAND ?? (process.platform === 'win32' ? 'python' : 'python3'), ['run_full_calendar_refresh.py'], {
        cwd: path.join(root, 'Economic_calendar'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', chunk => process.stdout.write(redact(chunk)));
      child.stderr.on('data', chunk => process.stderr.write(redact(chunk)));
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw Error(`Calendar refresh failed (exit ${code}).`);
    const merged = JSON.parse(readFileSync(path.join(root, 'Economic_calendar', 'all_calendar_results.json'), 'utf8'));
    const failures = merged.metrics.filter(metric => metric.release_status === 'source_error');
    if (failures.length) throw Error(`Calendar refresh partially completed: ${failures.length} provider schedules could not be fetched. Retry is required.`);
    if (process.env.CALENDAR_REFRESH_LOCK_HELD !== '1') {
      await saveRefreshState(statePath, { ...await readRefreshState(statePath), lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null });
    }
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
  finally { await unlock(); process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
