import assert from "node:assert/strict";
import { normalizeFreeConsensusEvent, fetchFreeConsensus } from "./free-consensus";

async function main() {
  const row = { id: "usd-initial-jobless-claims.20261112T1330", currency: "USD", title: "Initial Jobless Claims", time: "2026-11-12T13:30:00Z", status: "scheduled", forecast: "195K" };
  assert.equal(normalizeFreeConsensusEvent(row)?.metricId, "us-initial-claims");
  assert.equal(normalizeFreeConsensusEvent(row)?.forecast, 195000);
  assert.equal(normalizeFreeConsensusEvent({ ...row, forecast: "" })?.forecast, null);
  assert.equal(normalizeFreeConsensusEvent({ ...row, currency: "EUR", title: "Harmonized Index of Consumer Prices YoY (ES)" }), null);
  assert.equal(normalizeFreeConsensusEvent({ ...row, currency: "EUR", title: "Harmonized Index of Consumer Prices YoY (EA)", forecast: "2.1%" })?.metricId, "ea-hicp-yoy");
  assert.equal(normalizeFreeConsensusEvent({ ...row, status: "tentative" }), null);
  assert.equal(normalizeFreeConsensusEvent({ ...row, currency: "EUR", title: "Gross Domestic Product s.a. YoY", forecast: "1.3%" })?.metricId, "ea-gdp-yoy");
  const result = await fetchFreeConsensus(async (input) => {
    assert.match(String(input), /showmytrades\.com/);
    return new Response(JSON.stringify({ events: [row], from: "2026-11-12T07:15:20Z", to: "2026-11-20T13:15:20Z" }), { status: 200 });
  });
  assert.equal(result.events.length, 1);
  await assert.rejects(() => fetchFreeConsensus(async () => new Response("no", { status: 503 })));
  console.log("Free consensus feed checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
