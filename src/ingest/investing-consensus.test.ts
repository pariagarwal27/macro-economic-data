import assert from "node:assert/strict";
import { consensusArchiveStatements, normalizeInvestingConsensus } from "./investing-consensus";

async function main() {
  const now = new Date("2026-11-12T10:00:00Z");
  const result = normalizeInvestingConsensus({ complete: true, date: "2026-11-12", rows: [{ date: "2026-11-12", time: "13:30", country: "US", currency: "USD", event: "Initial Jobless Claims", forecast: "195K" }] }, "2026-11-12");
  assert.equal(result.events[0].forecast, 195000);
  assert.equal(result.events[0].metricId, "us-initial-claims");
  const archive = consensusArchiveStatements(result.events, now.toISOString());
  assert.equal(archive.length, 1);
  assert.match(archive[0].sql, /INSERT OR IGNORE INTO nfp_consensus_archive/);
  assert.equal(archive[0].args.at(-1), now.toISOString());
  assert.throws(() => normalizeInvestingConsensus({ complete: false, date: "2026-11-12", rows: [] }, "2026-11-12"));
  assert.throws(() => normalizeInvestingConsensus({ complete: true, date: "2026-11-13", rows: [] }, "2026-11-12"));
  console.log("Investing consensus collector checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
