import assert from "node:assert/strict";

async function main() {
  // This test cannot touch the application database or external sources.
  process.env.DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_AUTH_TOKEN;
  const { ensureSchema, seedCatalog } = await import("../src/ingest/pipeline");
  const { getClient } = await import("../src/db");
  const { processFetchedRelease } = await import("../src/ingest/release-processor");
  const { persistRelease } = await import("../src/ingest/db-writer");
  const ids = ["ea-safe-selling-price-exp-1y", "ea-safe-input-cost-exp-1y", "ea-safe-wage-exp-1y"];
  await ensureSchema();
  await seedCatalog({ metricIds: ids, cleanupOrphans: false });
  for (const metricId of ids) {
    await persistRelease({ metricId, periodDate: "2026-06-01", value: 2, releasedAt: "2026-07-01T09:00:00Z" });
    const input = { metricId, scheduledAt: "2026-10-26T09:00:00Z", result: { periodDate: "2026-06-01", value: 2 } };
    const unchanged = await processFetchedRelease(input);
    assert.equal(unchanged.updated, false);
    assert.equal(unchanged.reason, "no-new-release", `${metricId}: old source value must remain retryable`);
    const older = await processFetchedRelease({ ...input, result: { periodDate: "2026-03-01", value: 3 } });
    assert.equal(older.updated, false);
    assert.equal(older.reason, "source-period-older-than-db");
    // An unchanged numeric expectation in a NEW survey quarter is a release.
    const next = { ...input, result: { periodDate: "2026-09-01", value: 2, releasedAt: "2026-10-26T09:00:01Z" } };
    assert.equal((await processFetchedRelease(next)).updated, true);
    const repeated = await processFetchedRelease(next);
    assert.equal(repeated.updated, false);
    assert.equal(repeated.reason, "already-recorded", `${metricId}: another refresher's committed release must complete dispatch`);
    const rows = await getClient().execute({ sql: "SELECT date,value FROM observations WHERE metric_id = ? ORDER BY date DESC", args: [metricId] });
    assert.equal(rows.rows[0].date, "2026-09-01");
    assert.equal(rows.rows[0].value, 2);
    const count = await getClient().execute({ sql: "SELECT COUNT(*) AS count FROM releases WHERE metric_id = ? AND period_date = ?", args: [metricId, "2026-09-01"] });
    assert.equal(count.rows[0].count, 1);
  }
  getClient().close();
  console.log("ECB SAFE: all three metrics reject stale values, accept a new quarter even at an unchanged value, and avoid duplicate releases (isolated in-memory database).");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
