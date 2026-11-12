import assert from "node:assert/strict";
import test from "node:test";
import { withFreshReleaseFetch } from "./release-fetch-context.js";
import { fetchOfficialLatestFromPipeline } from "./pipeline";

test("ONS release fetches do not wait before contacting the source", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const delays: number[] = [];
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response("Date,Value\n2026 SEP,3.2\n", {status: 200}); };
  globalThis.setTimeout = ((callback: (...args: never[]) => void, delay?: number) => {
    delays.push(Number(delay));
    return originalTimer(callback, 0);
  }) as unknown as typeof setTimeout;
  try {
    const native = await withFreshReleaseFetch(() => fetchOfficialLatestFromPipeline("uk-clothing-cpi-yoy"));
    const mapped = await withFreshReleaseFetch(() => fetchOfficialLatestFromPipeline("uk-core-cpi-yoy"));
    assert.equal(native?.value, 3.2);
    assert.equal(mapped?.value, 3.2);
    assert.equal(requests, 2);
    assert.ok(!delays.includes(2000) && !delays.includes(400), `release requests must not incur the ONS pacing delay: ${delays}`);
    await fetchOfficialLatestFromPipeline("uk-clothing-cpi-yoy");
    assert.ok(delays.includes(2000), "routine ONS fetches retain their existing pacing");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
  }
});
