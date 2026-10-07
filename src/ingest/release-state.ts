import { executeSql } from "@/db";

let tableReady: Promise<void> | null = null;

async function ensureReleaseStateTable() {
  if (!tableReady) {
    tableReady = (async () => {
      const client = { execute: executeSql };

      await client.execute(`
        CREATE TABLE IF NOT EXISTS release_dispatch_state (
          metric_id TEXT NOT NULL,
          scheduled_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'retry',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TEXT,
          processed_at TEXT,
          last_error TEXT,
          PRIMARY KEY(metric_id, scheduled_at)
        )
      `);

      await client.execute(`
        CREATE INDEX IF NOT EXISTS
        release_dispatch_status_idx
        ON release_dispatch_state(status)
      `);
      const columns = await client.execute("PRAGMA table_info(release_dispatch_state)");
      if (!columns.rows.some(row => row.name === "release_id")) {
        try { await client.execute("ALTER TABLE release_dispatch_state ADD COLUMN release_id INTEGER"); }
        catch (error) { if (!/duplicate column/i.test(String(error))) throw error; }
      }
      await client.execute(`CREATE TABLE IF NOT EXISTS release_poll_state (
        metric_id TEXT PRIMARY KEY, scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL, last_attempt_at TEXT NOT NULL
      )`);
      // Bootstrap imported dispatch records once, so already completed releases
      // are filtered before a cron tick spends its query budget claiming them.
      await client.execute(`INSERT INTO release_poll_state(metric_id,scheduled_at,status,last_attempt_at)
        SELECT metric_id,scheduled_at,status,COALESCE(last_attempt_at,processed_at,'2000-01-01T00:00:00.000Z')
        FROM (
          SELECT *, ROW_NUMBER() OVER(PARTITION BY metric_id ORDER BY COALESCE(last_attempt_at,processed_at,'') DESC) AS rn
          FROM release_dispatch_state WHERE NOT EXISTS(SELECT 1 FROM release_poll_state)
        ) WHERE rn = 1 ON CONFLICT(metric_id) DO NOTHING`);
    })();
  }

  await tableReady;
}

export async function claimRelease(
  metricId: string,
  scheduledAt: string
) {
  await ensureReleaseStateTable();

  const client = { execute: executeSql };

  const now =
    new Date().toISOString();

  /*
   * A normal cron execution should finish well
   * before this. If a previous invocation is stuck,
   * allow another worker to reclaim it after 2 minutes.
   */
  const staleBefore =
    new Date(
      Date.now() - 2 * 60_000
    ).toISOString();

  await client.execute({
    sql: `
      INSERT INTO release_dispatch_state (
        metric_id,
        scheduled_at,
        status
      )
      VALUES (?, ?, 'retry')
      ON CONFLICT(metric_id, scheduled_at)
      DO NOTHING
    `,
    args: [
      metricId,
      scheduledAt,
    ],
  });

  const result =
    await client.execute({
      sql: `
        UPDATE release_dispatch_state
        SET
          status = 'processing',
          attempts = attempts + 1,
          last_attempt_at = ?,
          last_error = NULL
        WHERE
          metric_id = ?
          AND scheduled_at = ?
          AND status != 'processed'
          AND (
            last_attempt_at IS NULL
            OR last_attempt_at < ?
          )
      `,
      args: [
        now,
        metricId,
        scheduledAt,
        staleBefore,
      ],
    });

  const claimed = Number(result.rowsAffected ?? 0) === 1;
  if (claimed) await executeSql({
    sql: `INSERT INTO release_poll_state(metric_id,scheduled_at,status,last_attempt_at)
      VALUES(?,?,'processing',?) ON CONFLICT(metric_id) DO UPDATE SET
      scheduled_at=excluded.scheduled_at,status=excluded.status,last_attempt_at=excluded.last_attempt_at`,
    args: [metricId, scheduledAt, now],
  });
  return claimed;
}

export async function markReleaseRetry(
  metricId: string,
  scheduledAt: string,
  error?: string
) {
  await ensureReleaseStateTable();

  await executeSql({
    sql: `
      UPDATE release_dispatch_state
      SET
        status = 'retry',
        last_error = ?
      WHERE
        metric_id = ?
        AND scheduled_at = ?
    `,
    args: [
      error ?? null,
      metricId,
      scheduledAt,
    ],
  });
  await executeSql({ sql: "UPDATE release_poll_state SET status = 'retry' WHERE metric_id = ? AND scheduled_at = ?", args: [metricId, scheduledAt] });
}

export async function markReleaseProcessed(
  metricId: string,
  scheduledAt: string,
  releaseId?: number | null
) {
  await ensureReleaseStateTable();

  await executeSql({
    sql: `
      UPDATE release_dispatch_state
      SET
        status = 'processed',
        processed_at = ?,
        release_id = ?,
        last_error = NULL
      WHERE
        metric_id = ?
        AND scheduled_at = ?
    `,
    args: [
      new Date().toISOString(),
      releaseId ?? null,
      metricId,
      scheduledAt,
    ],
  });
  await executeSql({ sql: "UPDATE release_poll_state SET status = 'processed' WHERE metric_id = ? AND scheduled_at = ?", args: [metricId, scheduledAt] });
}

export async function getCompletedCalendarReleases(since: string) {
  await ensureReleaseStateTable();
  const result = await executeSql({
    sql: `SELECT s.metric_id,s.scheduled_at,s.processed_at,s.release_id,
      r.released_at,r.value,r.expected_value,r.prior_period_value
      FROM release_dispatch_state s LEFT JOIN releases r ON r.id=s.release_id
      WHERE s.status='processed' AND s.processed_at>=? AND s.scheduled_at NOT LIKE 'safety:%'`,
    args: [since],
  });
  return result.rows.map(row => ({
    metricId: String(row.metric_id), scheduledAt: String(row.scheduled_at),
    processedAt: String(row.processed_at), releaseId: row.release_id == null ? null : Number(row.release_id),
    actual: row.released_at == null ? null : {
      id: Number(row.release_id), metricId: String(row.metric_id), releasedAt: String(row.released_at),
      value: row.value == null ? null : Number(row.value), expectedValue: row.expected_value == null ? null : Number(row.expected_value),
      priorPeriodValue: row.prior_period_value == null ? null : Number(row.prior_period_value),
    },
  }));
}

export async function getPollState() {
  await ensureReleaseStateTable();
  const result = await executeSql("SELECT metric_id, scheduled_at, status, last_attempt_at FROM release_poll_state");
  return new Map(result.rows.map(row => [String(row.metric_id), {
    scheduledAt: String(row.scheduled_at), status: String(row.status),
    lastAttemptAt: String(row.last_attempt_at),
  }]));
}
