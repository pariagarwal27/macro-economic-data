import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

test("the stream skips the initial snapshot and pushes a newly committed release", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "macro-release-stream-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "stream.db").replace(/\\/g, "/")}`;
  const { getClient } = await import("@/db");
  const db = getClient();
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await db.execute("CREATE TABLE releases (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_id TEXT, period_date TEXT, released_at TEXT, value REAL, notes TEXT, change_vs_prior_release REAL)");
    await db.execute({sql:"INSERT INTO releases(metric_id,period_date,released_at,value) VALUES(?,?,?,?)", args:["us-cpi-yoy", "2026-08-01", "2026-09-01T13:30:00Z", 3]});
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/releases/stream", {signal:abort.signal}));
    assert.equal(response.headers.get("content-type")?.startsWith("text/event-stream"), true);
    reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes('"cursor":1')) text += decoder.decode((await reader.read()).value);
    assert.ok(text.includes('"updates":[]'));
    const committedAt = Date.now();
    await db.execute({sql:"INSERT INTO releases(metric_id,period_date,released_at,value) VALUES(?,?,?,?)", args:["us-cpi-yoy", "2026-09-01", "2026-10-28T13:30:00Z", 3.2]});
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("release stream did not deliver the new record")), 4000));
    while (!text.includes('"metricId":"us-cpi-yoy"')) text += decoder.decode((await Promise.race([reader.read(), timeout])).value);
    assert.ok(text.includes('"cursor":2'));
    assert.ok(text.includes('"value":3.2'));
    console.log(`Stream delivered the locally committed release in ${Date.now() - committedAt} ms`);
  } finally {
    abort.abort();
    await reader?.cancel();
    db.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
