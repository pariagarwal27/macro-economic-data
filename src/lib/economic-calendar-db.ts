import { createClient } from "@libsql/client";
import path from "path";
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
  updatedAt: string | null;
};

export async function getEconomicCalendarRows(): Promise<
  ScheduledCalendarRow[]
> {
  const dbPath = path.join(
    process.cwd(),
    "Economic_calendar",
    "economic_calendar.db"
  );

  const database = getD1Database();
  const client = database ? null : createClient({
    url: `file:${dbPath.replace(/\\/g, "/")}`,
  });

  try {
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
        updated_at
      FROM calendar
      WHERE next_release_date IS NOT NULL
        AND TRIM(next_release_date) <> ''
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

      updatedAt:
        row.updated_at == null
          ? null
          : String(row.updated_at),
    }));
  } finally {
    client?.close();
  }
}
