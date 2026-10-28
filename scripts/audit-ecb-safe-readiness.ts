import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";

// Read-only release readiness check. Simulated timestamps discover candidates;
// they never dispatch a release or claim/write release state.
async function main() {
  loadEnvConfig(process.cwd());
  const { getDueReleaseCandidates } = await import("../src/ingest/release-dispatcher");
  const { fetchMetricFromOfficialSource } = await import("../src/ingest/source-adapter");
  const { getSourceConfig } = await import("../src/ingest/source-registry");
  const ids = ["ea-safe-selling-price-exp-1y", "ea-safe-input-cost-exp-1y", "ea-safe-wage-exp-1y"];
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), databaseMode: process.env.DATABASE_URL ? (process.env.DATABASE_URL.startsWith("file:") ? "configured-local-file" : "configured-remote") : "default-local-file" }));
  const before = await getDueReleaseCandidates(new Date("2026-10-26T08:59:59Z"));
  const at = await getDueReleaseCandidates(new Date("2026-10-26T09:00:00Z"));
  for (const id of ids) {
    assert(!before.some(row => row.metricId === id), `${id} must not be due before official release time`);
    const candidate = at.find(row => row.metricId === id);
    assert(candidate, `${id} must be due at official release time`);
    assert.equal(Date.parse(candidate.scheduledAt), Date.parse("2026-10-26T09:00:00Z"));
    console.log(JSON.stringify({ id, candidate, source: getSourceConfig(id) }));
  }
  for (const id of ids) {
    const started = Date.now();
    const latest = await fetchMetricFromOfficialSource(id);
    assert(latest && Number.isFinite(latest.value) && latest.periodDate, `${id} source must return a finite dated value`);
    console.log(JSON.stringify({ id, liveSource: latest, fetchMs: Date.now() - started }));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
