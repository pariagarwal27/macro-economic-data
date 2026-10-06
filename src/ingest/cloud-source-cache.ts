import { executeSql, getD1Database } from "@/db";

let ready: Promise<unknown> | null = null;

export async function getSourceSnapshot<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (!getD1Database()) return load();
  ready ??= executeSql(`CREATE TABLE IF NOT EXISTS cloud_source_cache (
    cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`);
  await ready;
  const existing = await executeSql({ sql: "SELECT payload, expires_at FROM cloud_source_cache WHERE cache_key = ?", args: [key] });
  if (existing.rows[0] && Number(existing.rows[0].expires_at) > Date.now()) {
    return JSON.parse(String(existing.rows[0].payload)) as T;
  }
  const value = await load();
  const payload = JSON.stringify(value);
  if (payload.length < 1_500_000) await executeSql({
    sql: `INSERT INTO cloud_source_cache(cache_key,payload,expires_at) VALUES(?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`,
    args: [key, payload, Date.now() + ttlMs],
  });
  return value;
}
