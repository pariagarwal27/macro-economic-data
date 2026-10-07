import { createClient } from "@libsql/client";
import path from "path";
import fs from "node:fs";
import { getD1Database } from "@/db";
import { readD1 } from "@/db/d1-read";

export type ScheduledCalendarRow = {
  metricId: string;
  metricName: string | null;
  source: string | null;
  family: string | null;
  nextReleaseDate: string | null;
  nextReleaseAt: string | null;
  status: string | null;
  officialSource: string | null;
  officialEvidence?: string | null;
  updatedAt: string | null;
  releaseDeadlineAt?: string | null;
  releaseTimeKind?: string | null;
};

export async function getEconomicCalendarRows(options?: { includeUnscheduled?: boolean; history?: boolean }): Promise<
  ScheduledCalendarRow[]
> {
  const seedPath = path.join(
    process.cwd(),
    "Economic_calendar",
    "economic_calendar.db"
  );
  const dbPath = path.resolve(process.env.CALENDAR_DB_PATH ?? seedPath);

  const database = getD1Database();
  if (!database && dbPath !== seedPath && !fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(seedPath, dbPath, fs.constants.COPYFILE_EXCL);
  }
  const client = database ? null : createClient({
    url: `file:${dbPath.replace(/\\/g, "/")}`,
  });

  try {
    const table = options?.history ? "calendar_history" : "calendar";
    const query = async (sql: string) => database ? await readD1(database, { sql }) : await client!.execute(sql);
    const columns = await query(`PRAGMA table_info(${table})`);
    if (!columns.rows.length && options?.history) return [];
    const names = new Set(columns.rows.map(row => String(row.name)));
    const sql = `
      SELECT
        metric_id,
        metric,
        source,
        family,
        next_release_date,
        next_release_at,
        status,
        official_source,
        official_evidence,
        ${names.has("release_deadline_at") ? "release_deadline_at" : "NULL AS release_deadline_at"},
        ${names.has("release_time_kind") ? "release_time_kind" : "NULL AS release_time_kind"},
        updated_at
      FROM ${table}
      ${options?.includeUnscheduled ? "" : "WHERE next_release_date IS NOT NULL AND TRIM(next_release_date) <> ''"}
      ORDER BY next_release_date ASC, metric ASC
    `;
    const result = database ? await readD1(database, { sql }) : await client!.execute(sql);

    return result.rows.map((row) => ({
      metricId: String(row.metric_id ?? ""),

      metricName:
        row.metric == null
          ? null
          : String(row.metric),

      source:
        row.source == null
          ? null
          : String(row.source),

      family:
        row.family == null
          ? null
          : String(row.family),

      nextReleaseDate:
        row.next_release_date == null
          ? null
          : String(row.next_release_date),

      nextReleaseAt:
        row.next_release_at == null
          ? null
          : String(row.next_release_at),

      status:
        row.status == null
          ? null
          : String(row.status),

      officialSource:
        row.official_source == null
          ? null
          : String(row.official_source),
      officialEvidence: row.official_evidence == null ? null : String(row.official_evidence),
      releaseDeadlineAt: row.release_deadline_at == null ? null : String(row.release_deadline_at),
      releaseTimeKind: row.release_time_kind == null ? null : String(row.release_time_kind),

      updatedAt:
        row.updated_at == null
          ? null
          : String(row.updated_at),
    }));
  } finally {
    client?.close();
  }
}
