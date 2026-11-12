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
  await seedCatalog({ metricIds: [metricId, "ea-gdp-qoq"], cleanupOrphans: false });
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

  await client.execute({
    sql: "INSERT INTO observations(metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES(?,?,?,?,?,?,1)",
    args: ["ea-gdp-qoq", "2026-07-01", 0.2, 0.2, "2026-10-30T10:00:00Z", "2026-10-30"],
  });
  await client.execute({
    sql: "INSERT INTO releases(metric_id,period_date,released_at,value,notes) VALUES(?,?,?,?,?)",
    args: ["ea-gdp-qoq", "2026-07-01", "2026-10-30T10:00:00Z", 0.2, "[release-stage:flash] initial Q3 flash"],
  });
  const sameValueT45 = await processFetchedRelease({
    metricId: "ea-gdp-qoq", scheduledAt: "2026-11-13T11:00:00+01:00",
    result: { periodDate: "2026-07-01", value: 0.2, releaseStage: "flash", releasedAt: "2026-11-13T10:00:05Z" },
  });
  assert.equal(sameValueT45.updated, true, "the T+45 flash publication is recorded even when it repeats the same value");
  const final = await processFetchedRelease({
    metricId: "ea-gdp-qoq", scheduledAt: "2026-12-07T11:00:00+01:00",
    result: { periodDate: "2026-07-01", value: 0.2, releaseStage: "final", releasedAt: "2026-12-07T10:00:05Z" },
  });
  assert.equal(final.updated, true, "the regular final vintage replaces an unchanged flash value");
  const vintages = await client.execute({
    sql: "SELECT notes FROM releases WHERE metric_id=? AND period_date=? ORDER BY released_at",
    args: ["ea-gdp-qoq", "2026-07-01"],
  });
  assert.deepEqual(vintages.rows.map(row => row.notes), [
    "[release-stage:flash] initial Q3 flash",
    "[release-stage:flash] Official scheduled release confirmed unchanged for 2026-07-01",
    "[release-stage:final] Official scheduled release confirmed unchanged for 2026-07-01",
  ]);
  const latestGdp = await client.execute({ sql: "SELECT date,value,is_latest FROM observations WHERE metric_id=? ORDER BY id DESC LIMIT 1", args: ["ea-gdp-qoq"] });
  assert.deepEqual(latestGdp.rows[0], { date: "2026-07-01", value: 0.2, is_latest: 1 });
  client.close();
});
