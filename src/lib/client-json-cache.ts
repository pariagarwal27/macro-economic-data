const MAX_CLIENT_CACHE_ENTRIES = 24;

const values = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

/** Return the last successful payload immediately while a fresh one is fetched. */
export function getClientJsonCache<T>(key: string): T | undefined {
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
    values.delete(key);
    values.set(key, payload);
    while (values.size > MAX_CLIENT_CACHE_ENTRIES) {
      const oldestKey = values.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      values.delete(oldestKey);
    }
    return payload;
  })();

  pending.set(key, request);
  try {
    return await request;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}
