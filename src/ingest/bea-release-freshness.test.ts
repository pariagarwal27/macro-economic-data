import assert from "node:assert/strict";
import test from "node:test";
import { beginOfficialSourceCycle, endOfficialSourceCycle, fetchOfficialLatestFromPipeline } from "./pipeline";
import { withFreshReleaseFetch } from "./release-fetch-context.js";
import { fetchBeaNipa } from "./bea";

test("release-time BEA fetch does not reuse a pre-release refresh snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.BEA_API_KEY;
  let requests = 0;
  process.env.BEA_API_KEY = "test-key";
  globalThis.fetch = async () => {
    requests++;
    return Response.json({BEAAPI:{Results:{Data:[{LineNumber:"1", TimePeriod:"2026M09", DataValue: requests === 1 ? "100" : "101"}]}}});
  };
  beginOfficialSourceCycle();
  try {
    const previous = await fetchOfficialLatestFromPipeline("us-pce");
    const release = await withFreshReleaseFetch(() => fetchOfficialLatestFromPipeline("us-pce"));
    assert.equal(previous?.value, 100);
    assert.equal(release?.value, 101);
    assert.equal(requests, 2);
  } finally {
    endOfficialSourceCycle();
    globalThis.fetch = originalFetch;
    if (originalKey == null) Reflect.deleteProperty(process.env, "BEA_API_KEY");
    else process.env.BEA_API_KEY = originalKey;
  }
});

test("simultaneous PCE components share one in-flight BEA table response", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.BEA_API_KEY;
  let requests = 0;
  process.env.BEA_API_KEY = "test-key";
  let unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  globalThis.fetch = async () => {
    requests++;
    await gate;
    return Response.json({BEAAPI:{Results:{Data:[{LineNumber:"1", TimePeriod:"2026M09", DataValue:"100"}, {LineNumber:"25", TimePeriod:"2026M09", DataValue:"102"}]}}});
  };
  try {
    const headline = withFreshReleaseFetch(() => fetchBeaNipa("T20804", "1"));
    const core = withFreshReleaseFetch(() => fetchBeaNipa("T20804", "25"));
    unblock();
    const [a, b] = await Promise.all([headline, core]);
    assert.equal(a.at(-1)?.value, 100);
    assert.equal(b.at(-1)?.value, 102);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) Reflect.deleteProperty(process.env, "BEA_API_KEY");
    else process.env.BEA_API_KEY = originalKey;
  }
});
