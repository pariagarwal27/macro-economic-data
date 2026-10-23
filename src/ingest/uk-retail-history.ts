import { executeRead, getClient, getD1Database } from '@/db';
import { UK_RETAIL_RELEASE_IDS } from '@/lib/uk-retail';

type Statement = { sql: string; args: (string | number | null)[] };
type Point = { date: string; value: number };
type Store = {
  execute: (statement: Statement) => Promise<{ rows: { [key: string]: unknown }[] }>;
  batch: (statements: Statement[]) => Promise<unknown>;
};

/** Save the entire ONS vintage atomically, including revisions to prior months. */
export async function persistUkRetailHistory(metricId: string, history: Point[], releasedAt: string, store?: Store) {
  if (!UK_RETAIL_RELEASE_IDS.includes(metricId)) throw new Error('Not a UK retail release series');
  const points = [...history].sort((a,b) => a.date.localeCompare(b.date));
  if (!points.length || new Set(points.map(p => p.date)).size !== points.length ||
      points.some(p => !/^\d{4}-\d{2}-01$/.test(p.date) || !Number.isFinite(p.value))) throw new Error('Invalid ONS monthly history');
  for (let i=1; i<points.length; i++) {
    const date = new Date(points[i-1].date + 'T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + 1);
    if (date.toISOString().slice(0,10) !== points[i].date) throw new Error('Incomplete ONS monthly history');
  }
  const database = getD1Database();
  const target = store ?? {
    execute: executeRead,
    batch: (statements: Statement[]) => database
      ? database.batch(statements.map(statement => database.prepare(statement.sql).bind(...statement.args)))
      : getClient().batch(statements, 'write'),
  };
  const previous = await target.execute({ sql: 'SELECT date,released_at FROM observations WHERE metric_id=?', args: [metricId] });
  const priorMonths = new Set(previous.rows.map(row => String(row.date)));
  if ([...priorMonths].some(date => date < points[0].date)) throw new Error('ONS retail history unexpectedly lost earlier months');
  if ([...priorMonths].some(date => date > points.at(-1)!.date)) throw new Error('ONS retail history is older than the database');
  const releaseDates = new Map(previous.rows.map(row => [String(row.date), row.released_at == null ? null : String(row.released_at)]));
  const statements: Statement[] = [{ sql: 'DELETE FROM observations WHERE metric_id=?', args: [metricId] }];
  // Keep each statement below D1's 100 bound-parameter limit.
  for (let start=0; start<points.length; start+=15) {
    const chunk = points.slice(start,start+15);
    statements.push({ sql: `INSERT INTO observations (metric_id,date,value,raw_value,released_at,vintage_date,is_latest) VALUES ${chunk.map(() => '(?,?,?,?,?,?,1)').join(',')}`,
      args: chunk.flatMap(point => [metricId,point.date,point.value,point.value,
        point.date === points.at(-1)!.date ? releasedAt : releaseDates.get(point.date) ?? null,
        `ons-${releasedAt.slice(0,10)}`]) });
  }
  statements.push({ sql: 'UPDATE metrics SET earliest_available=?,observation_count=?,last_ingested_at=? WHERE id=?', args: [points[0].date,points.length,new Date().toISOString(),metricId] });
  await target.batch(statements);
  return points.length;
}
