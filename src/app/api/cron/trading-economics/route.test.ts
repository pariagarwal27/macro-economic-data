import assert from "node:assert/strict";

async function main() {
  process.env.CRON_SECRET = "cron-test-secret";
  delete process.env.TRADING_ECONOMICS_API_KEY;
  const { GET } = await import("./route");
  assert.equal((await GET(new Request("https://example.test/api/cron/trading-economics"))).status, 401);
  const response = await GET(new Request("https://example.test/api/cron/trading-economics", { headers: { Authorization: "Bearer cron-test-secret" } }));
  assert.equal(response.status, 503);
  assert.match(JSON.stringify(await response.json()), /key is not configured/);
  console.log("Trading Economics cron authentication and missing key checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
