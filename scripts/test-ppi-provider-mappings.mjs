import assert from "node:assert/strict";
import { fetchEurostatPreset } from "../src/ingest/eurostat.ts";
import { applyTransform } from "../src/ingest/transforms.ts";

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  const url = new URL(String(input));
  requests.push(url);
  const geo = url.searchParams.get("geo");
  const point = geo === "EA19" ? ["2022-12", 12] : geo === "EA20" ? ["2025-12", 15] : ["2026-08", 18];
  return new Response(JSON.stringify({
    id: ["geo", "nace_r2", "time"], size: [1, 1, 1],
    dimension: { time: { category: { index: { [point[0]]: 0 } } } },
    value: { 0: point[1] },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const points = await fetchEurostatPreset("ea-ppi:MIG_CAG:PCH_PRE");
  assert.deepEqual(points.map(({ date }) => date), ["2022-12-01", "2025-12-01", "2026-08-01"]);
  assert.deepEqual(requests.map(url => url.searchParams.get("geo")), ["EA19", "EA20", "EA21"]);
  for (const url of requests) {
    assert.equal(url.pathname.endsWith("/sts_inppd_m"), true);
    assert.equal(url.searchParams.get("freq"), "M");
    assert.equal(url.searchParams.get("indic_bt"), "PRC_PRR_DOM");
    assert.equal(url.searchParams.get("nace_r2"), "MIG_CAG");
    assert.equal(url.searchParams.get("s_adj"), "NSA");
    assert.equal(url.searchParams.get("unit"), "PCH_PRE");
  }
} finally {
  globalThis.fetch = originalFetch;
}

const index = [
  { date: "2025-01-01", value: 100 }, { date: "2025-02-01", value: 102 },
  { date: "2026-01-01", value: 110 }, { date: "2026-02-01", value: 105 },
];
assert.ok(Math.abs(applyTransform(index, "pct_change_yoy").at(-1).value - 2.94117647) < 0.00001);
assert.ok(Math.abs(applyTransform(index, "pct_change_mom").at(-1).value + 4.54545455) < 0.00001);

console.log("Official PPI provider mappings and index rate transformations passed.");
