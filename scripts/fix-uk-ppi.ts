import { METRICS } from "../src/catalog/metrics";
import { fetchOnsSeries } from "../src/ingest/ons";
import { fetchOnsPpiBulletin } from "../src/ingest/ons-ppi-bulletin";
import { applyTransform, round } from "../src/ingest/transforms";
import { getClient, getDb } from "../src/db";
import { metrics } from "../src/db/schema";
import { eq } from "drizzle-orm";

const IDS = ["uk-ppi-input-yoy", "uk-ppi-output-yoy"] as const;

async function ingest(id: (typeof IDS)[number]) {
  const metric = METRICS.find((m) => m.id === id)!;
  await new Promise((r) => setTimeout(r, 2500));
  const raw = await fetchOnsSeries(metric.seriesId);
  const byDate = new Map<string, { date: string; value: number; rawValue?: number }>();
  for (const p of applyTransform(raw, metric.transform)) {
    byDate.set(p.date, { ...p, value: round(p.value) });
  }
  const pts = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const client = getClient();
  const db = getDb();
  const now = new Date().toISOString();
  await client.execute({
    sql: "DELETE FROM observations WHERE metric_id=?",
    args: [id],
  });
  for (let i = 0; i < pts.length; i += 300) {
    const chunk = pts.slice(i, i + 300);
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
      transform: metric.transform,
      source: metric.source,
      earliestAvailable: pts[0].date,
      lastIngestedAt: now,
      observationCount: pts.length,
    })
    .where(eq(metrics.id, id));
  console.log(id, "OK", pts.length, "latest", pts.at(-1));
}

async function overlayBulletin() {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await fetchOnsPpiBulletin();
  console.log("bulletin", b);
  const client = getClient();
  const db = getDb();
  const now = new Date().toISOString();
  const doc =
    "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/producerpriceinflation/latest";
  for (const [id, pt] of [
    ["uk-ppi-input-yoy", b.inputYoy],
    ["uk-ppi-output-yoy", b.outputYoy],
  ] as const) {
    if (!pt) continue;
    await client.execute({
      sql: "DELETE FROM observations WHERE metric_id=? AND date=?",
      args: [id, pt.date],
    });
    await client.execute({
      sql: "INSERT INTO observations (metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES (?,?,?,?,?,?,1)",
      args: [id, pt.date, pt.value, pt.value, now, "live-" + now.slice(0, 10)],
    });
    await client.execute({
      sql: `INSERT INTO releases (metric_id,period_date,released_at,value,supporting_doc_url,notes)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(metric_id,period_date,released_at) DO UPDATE SET
          value=excluded.value, notes=excluded.notes`,
      args: [id, pt.date, now, pt.value, doc, "Live ONS PPI bulletin"],
    });
    await db
      .update(metrics)
      .set({ lastIngestedAt: now, source: "ons" })
      .where(eq(metrics.id, id));
    console.log("overlay", id, pt);
  }
}

async function main() {
  for (const id of IDS) {
    await ingest(id);
  }
  await overlayBulletin();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
