import { METRICS } from "../src/catalog/metrics";
import { fetchFredSeries } from "../src/ingest/fred";
import { applyTransform, round } from "../src/ingest/transforms";
import { getClient, getDb } from "../src/db";
import { metrics } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { ensureSchema, seedCatalog } from "../src/ingest/pipeline";

const IDS = ["us-cpi-mom", "us-core-cpi-mom", "us-cpi-yoy", "us-core-cpi-yoy"];

async function main() {
  await ensureSchema();
  await seedCatalog();
  const client = getClient();
  const db = getDb();

  for (const id of IDS) {
    const metric = METRICS.find((m) => m.id === id)!;
    const raw = (await fetchFredSeries(metric.seriesId)).points;
    const byDate = new Map<string, { date: string; value: number; rawValue?: number }>();
    for (const p of applyTransform(raw, metric.transform)) {
      byDate.set(p.date, { ...p, value: round(p.value) });
    }
    const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const now = new Date().toISOString();
    await client.execute({
      sql: "DELETE FROM observations WHERE metric_id=?",
      args: [id],
    });
    for (let i = 0; i < unique.length; i += 300) {
      const chunk = unique.slice(i, i + 300);
      const ph = chunk.map(() => "(?,?,?,?,?,?,1)").join(",");
      const args: (string | number | null)[] = [];
      for (const p of chunk) {
        args.push(id, p.date, p.value, p.rawValue ?? null, now, now.slice(0, 10));
      }
      await client.execute({
        sql: `INSERT INTO observations (metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES ${ph}`,
        args,
      });
    }
    await db
      .update(metrics)
      .set({
        lastIngestedAt: now,
        observationCount: unique.length,
        earliestAvailable: unique[0].date,
      })
      .where(eq(metrics.id, id));
    console.log(id, "OK", unique.at(-1));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
