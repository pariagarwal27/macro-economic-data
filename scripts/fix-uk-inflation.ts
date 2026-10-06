import { METRICS } from "../src/catalog/metrics";
import { ensureSchema, seedCatalog } from "../src/ingest/pipeline";
import { fetchOnsSeries } from "../src/ingest/ons";
import { fetchFredSeries } from "../src/ingest/fred";
import { applyTransform, round, type RawPoint } from "../src/ingest/transforms";
import { getClient, getDb } from "../src/db";
import { metrics } from "../src/db/schema";
import { eq } from "drizzle-orm";

const IDS = [
  "uk-cpi-yoy",
  "uk-cpih-yoy",
  "uk-core-cpi-yoy",
  "uk-rpi-yoy",
  "uk-ppi-input-yoy",
  "uk-ppi-output-yoy",
];

async function load(metric: (typeof METRICS)[number]): Promise<RawPoint[]> {
  if (metric.source === "ons") {
    await new Promise((r) => setTimeout(r, 900));
    return fetchOnsSeries(metric.seriesId);
  }
  const fred = await fetchFredSeries(metric.seriesId);
  return fred.points;
}

async function main() {
  await ensureSchema();
  await seedCatalog();
  const client = getClient();
  const db = getDb();

  for (const id of IDS) {
    const metric = METRICS.find((m) => m.id === id)!;
    try {
      const raw = await load(metric);
      const transformed = applyTransform(raw, metric.transform).map((p) => ({
        ...p,
        value: round(p.value),
      }));
      const byDate = new Map<string, (typeof transformed)[number]>();
      for (const p of transformed) byDate.set(p.date, p);
      const unique = [...byDate.values()].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      if (!unique.length) throw new Error("no points");

      const now = new Date().toISOString();
      await client.execute({
        sql: "DELETE FROM observations WHERE metric_id = ?",
        args: [id],
      });
      for (let i = 0; i < unique.length; i += 300) {
        const chunk = unique.slice(i, i + 300);
        const ph = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(",");
        const args: (string | number | null)[] = [];
        for (const p of chunk) {
          args.push(id, p.date, p.value, p.rawValue, now, now.slice(0, 10));
        }
        await client.execute({
          sql: `INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest)
                VALUES ${ph}`,
          args,
        });
      }
      await db
        .update(metrics)
        .set({
          seriesId: metric.seriesId,
          transform: metric.transform,
          source: metric.source,
          earliestAvailable: unique[0].date,
          lastIngestedAt: now,
          observationCount: unique.length,
        })
        .where(eq(metrics.id, id));

      const latest = unique[unique.length - 1];
      const prior = unique[unique.length - 2];
      console.log(
        id,
        "OK",
        unique.length,
        "latest",
        latest.date,
        latest.value,
        "priorΔ",
        prior ? round(latest.value - prior.value) : null
      );
    } catch (err) {
      console.error(id, "FAIL", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
