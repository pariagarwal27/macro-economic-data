/**
 * Re-ingest series now sourced from Eurostat/ONS APIs (replacing dead FRED).
 */
import { METRICS } from "../src/catalog/metrics";
import { ensureSchema, seedCatalog } from "../src/ingest/pipeline";
import { fetchOnsSeries } from "../src/ingest/ons";
import { fetchEurostatPreset } from "../src/ingest/eurostat";
import { fetchFredSeries } from "../src/ingest/fred";
import { fetchReleaseFeeds, mapFeedItemsToMetrics } from "../src/ingest/rss";
import { applyTransform, round, type RawPoint } from "../src/ingest/transforms";
import { getClient, getDb } from "../src/db";
import { metrics } from "../src/db/schema";
import { eq } from "drizzle-orm";

const IDS = [
  "uk-industrial-production",
  "ea-ppi-yoy",
  "ea-industrial-production",
  "ea-retail-sales",
  "ea-unemployed-persons",
  "ea-employment-yoy",
  "ea-unemployment",
  "ea-youth-unemployment",
];

async function load(metric: (typeof METRICS)[number]): Promise<RawPoint[]> {
  if (metric.source === "ons") {
    await new Promise((r) => setTimeout(r, 2200));
    return fetchOnsSeries(metric.seriesId);
  }
  if (metric.source === "eurostat") {
    return fetchEurostatPreset(metric.seriesId);
  }
  return (await fetchFredSeries(metric.seriesId)).points;
}

async function main() {
  await ensureSchema();
  await seedCatalog();

  try {
    const feeds = await fetchReleaseFeeds();
    const mapped = mapFeedItemsToMetrics(feeds);
    console.log("RSS items", feeds.length, "mapped metrics", mapped.size);
    console.log(
      "sample",
      [...mapped.entries()].slice(0, 6).map(([id, it]) => [id, it.source, it.title.slice(0, 60)])
    );
  } catch (e) {
    console.warn("RSS probe failed", e);
  }

  const client = getClient();
  const db = getDb();

  for (const id of IDS) {
    const metric = METRICS.find((m) => m.id === id)!;
    try {
      const raw = await load(metric);
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
        const ph = chunk.map(() => "(?, ?, ?, ?, ?, ?, 1)").join(",");
        const args: (string | number | null)[] = [];
        for (const p of chunk) {
          args.push(id, p.date, p.value, p.rawValue ?? null, now, now.slice(0, 10));
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

      console.log(id, "OK", unique.length, "latest", unique.at(-1));
    } catch (err) {
      console.error(id, "FAIL", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
