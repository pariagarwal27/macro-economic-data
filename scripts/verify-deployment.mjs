import assert from "node:assert/strict";

const base = process.argv[2] ?? "https://macro-economy-tracker.macro-economy-tracker.workers.dev";
const paths = [
  "/", "/country/US", "/country/UK", "/country/EA", "/calendar", "/desk",
  "/api/dashboard/US", "/api/dashboard/UK", "/api/dashboard/EA",
  "/api/metrics/us-cpi", "/api/economic-calendar", "/api/desk-matrix",
  "/api/desk-smoothed", "/api/data-freshness", "/api/metrics",
];

let failures = 0;
for (const path of paths) {
  try {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
    const body = await response.text();
    assert.ok(body.length > 100, `${path}: empty response`);
    if (path.startsWith("/api/")) {
      const data = JSON.parse(body);
      assert.ok(!data.error, `${path}: ${data.error}`);
      if (path.startsWith("/api/dashboard/")) {
        assert.ok(Object.keys(data).length >= 30, `${path}: missing series`);
        assert.ok(Object.values(data).some(series => series?.history?.length), `${path}: missing observations`);
      }
      if (path === "/api/economic-calendar") {
        assert.ok(data.lastUpdated, "Calendar database has no update timestamp");
        assert.ok(Object.values(data.week).flat().length, "Calendar contains no events");
      }
      if (path === "/api/metrics") assert.equal(data.cards.length, 349);
    }
    console.log(`PASS ${path} (${body.length} bytes; ${response.headers.get("X-Macro-Data") ?? "page"})`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${path}: ${error.message}`);
  }
}
assert.equal(failures, 0, `${failures} deployment checks failed`);
const unauthenticated = await fetch(base + "/api/cron/releases");
assert.equal(unauthenticated.status, 401, "The ingestion route must require its configured secret");
console.log("PASS refresh authentication (HTTP 401 without credentials)");
