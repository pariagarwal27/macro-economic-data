import { executeRead, getClient } from "@/db";

export type PceHistoryPoint = { date: string; value: number; rawValue?: number };

/** Publish revisions before recording the newest release. Release vintages stay in releases. */
export async function persistPceHistoryRevisions(metricId: string, history: PceHistoryPoint[]) {
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length || new Set(points.map(point => point.date)).size !== points.length ||
      points.some(point => !/^\d{4}-\d{2}-01$/.test(point.date) || !Number.isFinite(point.value))) {
    throw new Error("Invalid BEA PCE monthly history");
  }
  const previous = await executeRead({ sql: "SELECT id,date FROM observations WHERE metric_id=? ORDER BY id", args: [metricId] });
  const ids = new Map(previous.rows.map(row => [String(row.date), Number(row.id)]));
  if ([...ids.keys()].some(date => date > points.at(-1)!.date)) throw new Error("BEA PCE history is older than the database");
  const statements = points.slice(0, -1).flatMap(point => {
    const id = ids.get(point.date);
    return [
      { sql: "UPDATE observations SET is_latest=0 WHERE metric_id=? AND date=?", args: [metricId, point.date] },
      id != null
        ? { sql: "UPDATE observations SET value=?,raw_value=?,is_latest=1 WHERE id=?", args: [point.value, point.rawValue ?? point.value, id] }
        : { sql: "INSERT INTO observations(metric_id,date,value,raw_value,is_latest) VALUES(?,?,?,?,1)", args: [metricId, point.date, point.value, point.rawValue ?? point.value] },
    ];
  });
  if (statements.length) await getClient().batch(statements, "write");
}
