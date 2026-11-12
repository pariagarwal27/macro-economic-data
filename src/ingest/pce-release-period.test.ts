import assert from "node:assert/strict";
import test from "node:test";

test("PCE rejects a prior-month revision as today's release and preserves a coherent history", async () => {
  process.env.DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_AUTH_TOKEN;
  const { ensureSchema, seedCatalog } = await import("./pipeline");
  const { getClient } = await import("../db");
  const { processFetchedRelease } = await import("./release-processor");
  const { persistPceHistoryRevisions } = await import("./pce-history");
  await ensureSchema();
  await seedCatalog({ metricIds: ["us-core-pce"], cleanupOrphans: false });
  const client = getClient();
  await client.execute("INSERT INTO observations(metric_id,date,value,raw_value,is_latest) VALUES('us-core-pce','2026-08-01',130.455,130.455,1)");
  const stale = await processFetchedRelease({ metricId: "us-core-pce", scheduledAt: "2026-10-29T08:30:00-04:00", result: { periodDate: "2026-08-01", value: 130.489 } });
  assert.equal(stale.updated, false);
  assert.equal(stale.reason, "awaiting-pce-release-period");
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM releases")).rows[0].count, 0);
  await persistPceHistoryRevisions("us-core-pce", [{ date: "2026-07-01", value: 130.148 }, { date: "2026-08-01", value: 130.489 }, { date: "2026-09-01", value: 130.902 }]);
  assert.equal((await client.execute("SELECT MAX(date) AS date FROM observations")).rows[0].date, "2026-08-01");
  const current = await processFetchedRelease({ metricId: "us-core-pce", scheduledAt: "2026-10-29T08:30:00-04:00", result: { periodDate: "2026-09-01", value: 130.902 } });
  assert.equal(current.updated, true);
  assert.equal((await client.execute("SELECT prior_period_value FROM releases ORDER BY id DESC LIMIT 1")).rows[0].prior_period_value, 130.489);
  client.close();
});
