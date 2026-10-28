const MAX_CLIENT_CACHE_ENTRIES = 24;
const STORAGE_PREFIX = "macrohub:json:v1:";
const SNAPSHOT_MAX_AGE = 6 * 60 * 60 * 1000;

const values = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();
const refreshedAt = new Map<string, number>();

function remember(key: string, payload: unknown) {
  values.delete(key);
  values.set(key, payload);
  while (values.size > MAX_CLIENT_CACHE_ENTRIES) {
    const oldestKey = values.keys().next().value!;
    values.delete(oldestKey);
    refreshedAt.delete(oldestKey);
  }
}

function saveSnapshot(key: string, payload: unknown) {
  if (typeof window === "undefined") return;
  try {
    const storage = window.sessionStorage;
    const serialized = JSON.stringify({ savedAt: Date.now(), payload });
    try { storage.setItem(STORAGE_PREFIX + key, serialized); }
    catch {
      // Storage quotas vary. Evict only this app's older snapshots.
      const older: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const candidate = storage.key(index);
        if (candidate?.startsWith(STORAGE_PREFIX) && candidate !== STORAGE_PREFIX + key) older.push(candidate);
      }
      for (const candidate of older) {
        storage.removeItem(candidate);
        try { storage.setItem(STORAGE_PREFIX + key, serialized); break; } catch { /* Try the next snapshot. */ }
      }
    }
  } catch { /* Memory caching still works when browser storage is unavailable. */ }
}

/** Return the last successful payload immediately while a fresh one is fetched. */
export function getClientJsonCache<T>(key: string, restoreSnapshot = true): T | undefined {
  if (restoreSnapshot && !values.has(key) && typeof window !== "undefined") {
    try {
      const serialized = window.sessionStorage.getItem(STORAGE_PREFIX + key);
      if (serialized) {
        const snapshot = JSON.parse(serialized);
        if (typeof snapshot.savedAt === "number" && Date.now() - snapshot.savedAt < SNAPSHOT_MAX_AGE && snapshot.payload != null) {
          remember(key, snapshot.payload);
        } else window.sessionStorage.removeItem(STORAGE_PREFIX + key);
      }
    } catch { /* Ignore damaged snapshots or disabled storage. */ }
  }
  if (!values.has(key)) return undefined;
  const value = values.get(key) as T;
  // Keep frequently visited dashboards in the bounded LRU cache.
  values.delete(key);
  values.set(key, value);
  return value;
}

/** Fetch a fresh JSON payload, sharing concurrent requests for the same key. */
export async function refreshClientJson<T>(key: string, url: string, errorMessage?: string): Promise<T> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const request = (async () => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(errorMessage ?? `Request failed (${response.status})`);
    const payload = await response.json() as T;
    remember(key, payload);
    refreshedAt.set(key, Date.now());
    // Save outside the response/render path, especially for full country histories.
    setTimeout(() => saveSnapshot(key, payload), 0);
    return payload;
  })();

  pending.set(key, request);
  try {
    return await request;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}

/** Keep the visible dashboard available after a reload, within browser quotas. */
export function persistClientJsonCache(key: string): void {
  if (values.has(key)) {
    const payload = values.get(key);
    setTimeout(() => saveSnapshot(key, payload), 0);
  }
}

/** Warm navigation data without repeatedly downloading recently fetched histories. */
export async function prefetchClientJson(key: string, url: string): Promise<void> {
  if (values.has(key) && Date.now() - (refreshedAt.get(key) ?? 0) < 30_000) return;
  try { await refreshClientJson(key, url); } catch { /* The destination handles errors and retries. */ }
}
