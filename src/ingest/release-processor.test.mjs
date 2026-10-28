import assert from "node:assert/strict";
import { test } from "node:test";

test("new release records the previous observation for calendar history", async () => {
  process.env.DATABASE_URL = "file::memory:";
  delete process.env.DATABASE_AUTH_TOKEN;
  const { ensureSchema, seedCatalog } = await import("./pipeline.ts");
  const { getClient } = await import("../db/index.ts");
  const { processFetchedRelease } = await import("./release-processor.ts");
  const metricId = "ea-safe-selling-price-exp-1y";

  await ensureSchema();
  await seedCatalog({ metricIds: [metricId], cleanupOrphans: false });
  const client = getClient();
  await client.execute({
    sql: "INSERT INTO observations(metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES(?,?,?,?,?,?,1)",
    args: [metricId, "2026-06-01", 3.173, 3.173, "2026-07-20T10:00:00Z", "2026-07-20"],
  });

  const result = await processFetchedRelease({
    metricId,
    scheduledAt: "2026-10-26T09:00:00Z",
    result: { periodDate: "2026-09-01", value: 7.07 },
  });
  assert.equal(result.updated, true);

  const stored = await client.execute({
    sql: "SELECT prior_period_value,prior_period_date FROM releases WHERE metric_id=? AND period_date=? ORDER BY id DESC LIMIT 1",
    args: [metricId, "2026-09-01"],
  });
  assert.deepEqual(
    {
      priorPeriodValue: stored.rows[0].prior_period_value,
      priorPeriodDate: stored.rows[0].prior_period_date,
    },
    { priorPeriodValue: 3.173, priorPeriodDate: "2026-06-01" },
  );
  client.close();
});
