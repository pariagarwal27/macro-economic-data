import assert from "node:assert/strict";
import test from "node:test";
import { US_PPI_SERIES } from "../catalog/us-ppi.mjs";
import { fetchBlsSeries } from "./bls";
import { withFreshReleaseFetch } from "./release-fetch-context.js";

test("a later release retry fetches new PPI data instead of reusing an earlier release response", async () => {
  const originalFetch = globalThis.fetch;
  const seriesId = US_PPI_SERIES[0].seriesId;
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    const ids = JSON.parse(String(options?.body)).seriesid as string[];
    if (!ids.includes(seriesId)) return Response.json({status:"REQUEST_SUCCEEDED", Results:{series:[]}});
    requests++;
    return Response.json({status:"REQUEST_SUCCEEDED", Results:{series:[{seriesID:seriesId, data:[{year:"2026",period:"M09",value:requests === 1 ? "100" : "101"}]}]}});
  };
  try {
    const first = await withFreshReleaseFetch(() => fetchBlsSeries([seriesId]));
    const next = await withFreshReleaseFetch(() => fetchBlsSeries([seriesId]));
    assert.equal(first.get(seriesId)?.at(-1)?.value, 100);
    assert.equal(next.get(seriesId)?.at(-1)?.value, 101);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = originalFetch; }
});
