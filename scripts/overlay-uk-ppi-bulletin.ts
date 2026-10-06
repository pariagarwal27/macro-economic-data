import { fetchOnsPpiBulletin } from "../src/ingest/ons-ppi-bulletin";
import { getClient, getDb } from "../src/db";
import { metrics } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const b = await fetchOnsPpiBulletin();
  console.log("bulletin", b);
  if (!b.inputYoy && !b.outputYoy) {
    throw new Error("No PPI bulletin headlines parsed");
  }

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
          value=excluded.value, notes=excluded.notes, supporting_doc_url=excluded.supporting_doc_url`,
      args: [id, pt.date, now, pt.value, doc, "Live ONS PPI bulletin"],
    });
    await db
      .update(metrics)
      .set({ lastIngestedAt: now, source: "ons" })
      .where(eq(metrics.id, id));
    console.log(id, "tip", pt);
  }

  for (const id of ["uk-ppi-input-yoy", "uk-ppi-output-yoy"]) {
    const rows = await client.execute({
      sql: "SELECT date, value FROM observations WHERE metric_id=? ORDER BY date DESC LIMIT 3",
      args: [id],
    });
    console.log(id, rows.rows);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
