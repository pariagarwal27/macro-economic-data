import { METRICS } from "../src/catalog/metrics";
import { ensureSchema, seedCatalog } from "../src/ingest/pipeline";
import { fetchEurostatPreset } from "../src/ingest/eurostat";
import { applyTransform, round } from "../src/ingest/transforms";
import { getClient, getDb } from "../src/db";
import { metrics } from "../src/db/schema";
import { eq } from "drizzle-orm";

const IDS = [
  "ea-hicp-yoy",
  "ea-core-hicp-yoy",
  "de-cpi-yoy",
  "fr-cpi-yoy",
  "it-cpi-yoy",
  "es-cpi-yoy",
  "ea-esi",
  "ea-business-confidence",
];

async function main() {
  await ensureSchema();
  await seedCatalog();
  console.log("catalog size", METRICS.length);

  const client = getClient();
  const db = getDb();

  for (const id of IDS) {
    const metric = METRICS.find((m) => m.id === id)!;
    try {
      const raw = await fetchEurostatPreset(metric.seriesId);
      const byDate = new Map<string, { date: string; value: number; rawValue?: number }>();
      for (const p of applyTransform(raw, metric.transform)) {
        byDate.set(p.date, { ...p, value: round(p.value) });
      }
      const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (!unique.length) throw new Error("no points");
      const now = new Date().toISOString();
      await client.execute({
        sql: "DELETE FROM observations WHERE metric_id = ?",
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
          seriesId: metric.seriesId,
          source: metric.source,
          transform: metric.transform,
          lastIngestedAt: now,
          observationCount: unique.length,
          earliestAvailable: unique[0].date,
        })
        .where(eq(metrics.id, id));
      console.log(id, "OK", unique.at(-1));
    } catch (e) {
      console.error(id, "FAIL", e instanceof Error ? e.message : e);
    }
  }

  // Confirm orphans deleted
  const gone = [
    "us-adp-weekly",
    "uk-consumer-confidence",
    "ea-hicp-flash",
    "ea-cli",
  ];
  for (const id of gone) {
    const r = await client.execute({
      sql: "SELECT COUNT(*) AS c FROM metrics WHERE id=?",
      args: [id],
    });
    console.log("removed?", id, Number(r.rows[0]?.c) === 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
