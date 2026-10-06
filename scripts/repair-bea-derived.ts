import { and, asc, eq } from "drizzle-orm";
import { METRICS, type MetricDef } from "@/catalog/metrics";
import { getDb, getClient } from "@/db";
import { metrics, observations, releases } from "@/db/schema";
import { applyTransform, round, type RawPoint } from "@/ingest/transforms";

function baseMetricFor(metric: MetricDef): MetricDef | null {
  if (metric.source !== "bea") return null;
  if (!["pct_change", "pct_change_mom", "pct_change_yoy"].includes(metric.transform)) return null;

  return (
    METRICS.find(
      (candidate) =>
        candidate.source === "bea" &&
        candidate.seriesId === metric.seriesId &&
        ["level", "index"].includes(candidate.transform)
    ) ?? null
  );
}

async function repairMetric(metric: MetricDef, base: MetricDef) {
  const db = getDb();
  const client = getClient();

  const baseRows = await db
    .select({ date: observations.date, value: observations.value })
    .from(observations)
    .where(and(eq(observations.metricId, base.id), eq(observations.isLatest, true)))
    .orderBy(asc(observations.date));

  const raw: RawPoint[] = baseRows
    .map((row) => ({ date: String(row.date), value: Number(row.value) }))
    .filter((row) => Number.isFinite(row.value));

  const derived = applyTransform(raw, metric.transform).map((point) => ({
    date: point.date,
    value: round(point.value),
    rawValue: point.rawValue,
  }));

  let updated = 0;
  for (const point of derived) {
    const existing = await client.execute({
      sql: `SELECT id FROM observations WHERE metric_id = ? AND date = ? ORDER BY id DESC LIMIT 1`,
      args: [metric.id, point.date],
    });

    if (existing.rows[0]) {
      await client.execute({
        sql: `UPDATE observations SET value = ?, raw_value = ? WHERE id = ?`,
        args: [point.value, point.rawValue, existing.rows[0].id],
      });
    } else {
      await client.execute({
        sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest)\n              VALUES (?, ?, ?, ?, ?, ?, 1)`,
        args: [metric.id, point.date, point.value, point.rawValue, new Date().toISOString(), `repair-${new Date().toISOString().slice(0, 10)}`],
      });
    }
    updated += 1;

    await client.execute({
      sql: `UPDATE releases SET value = ? WHERE metric_id = ? AND period_date = ?`,
      args: [point.value, metric.id, point.date],
    });
  }

  await db
    .update(metrics)
    .set({
      lastIngestedAt: new Date().toISOString(),
      observationCount: derived.length,
    })
    .where(eq(metrics.id, metric.id));

  return { metricId: metric.id, baseMetricId: base.id, updated, latest: derived.at(-1) ?? null };
}

async function main() {
  const targets = METRICS
    .map((metric) => ({ metric, base: baseMetricFor(metric) }))
    .filter((x): x is { metric: MetricDef; base: MetricDef } => Boolean(x.base));

  const results = [];
  for (const { metric, base } of targets) {
    results.push(await repairMetric(metric, base));
  }

  console.log(JSON.stringify({ repaired: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
