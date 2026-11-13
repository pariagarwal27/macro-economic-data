import assert from "node:assert/strict";
import test from "node:test";
import { fetchEurostatGdpFlashRelease } from "./eurostat-gdp-flash";

test("the scheduled Q3 GDP flash is read from Eurostat's release article", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    return new Response(`
      <p>In the third quarter of 2026, seasonally adjusted GDP increased by 0.4% in the euro area and by 0.5% in the EU, compared with the previous quarter.</p>
      <p>Compared with the same quarter of the previous year, seasonally adjusted GDP increased by 1.3% in the euro area and by 1.5% in the EU.</p>
    `);
  };
  try {
    const qoq = await fetchEurostatGdpFlashRelease("ea-gdp-qoq", "2026-07-01", "2026-10-30T11:00:00+01:00");
    const yoy = await fetchEurostatGdpFlashRelease("ea-gdp-yoy", "2026-07-01", "2026-10-30T11:00:00+01:00");
    assert.equal(qoq?.value, 0.4);
    assert.equal(yoy?.value, 1.3);
    assert.equal(qoq?.releaseStage, "flash");
    assert.equal(qoq?.periodDate, "2026-07-01");
    assert.ok(calls.every(url => url === "https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-30102026-ap"));
  } finally {
    globalThis.fetch = original;
  }
});

test("the flash article fallback does not fabricate future-quarter values", async () => {
  let requested = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { requested = true; return new Response("{}"); };
  try {
    assert.equal(await fetchEurostatGdpFlashRelease("ea-gdp-qoq", "2026-10-01", "2027-01-29"), null);
    assert.equal(await fetchEurostatGdpFlashRelease("ea-gdp-qoq", "2026-07-01", "2026-11-13"), null);
    assert.equal(requested, false);
  } finally {
    globalThis.fetch = original;
  }
});
