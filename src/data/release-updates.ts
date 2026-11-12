import { executeRead } from "@/db";
import { releaseStageFromNote } from "@/ingest/release-stages";
import { dashboardReleaseTarget, type ReleaseUpdate } from "@/lib/release-notifications";

type Query = (query: { sql: string; args?: (string | number | null)[] }) => Promise<{ rows: readonly Record<string, unknown>[] }>;
export async function readReleaseUpdates(after: number | null, query: Query = executeRead): Promise<{ cursor: number; updates: ReleaseUpdate[]; hasMore: boolean }> {
  if (after == null) {
    const result = await query({ sql: "SELECT COALESCE(MAX(id), 0) AS id FROM releases" });
    return { cursor: Number(result.rows[0]?.id ?? 0), updates: [], hasMore: false };
  }
  const result = await query({ sql: "SELECT id, metric_id, period_date, released_at, value, notes, change_vs_prior_release FROM releases WHERE id > ? ORDER BY id ASC LIMIT 250", args: [after] });
  const updates = result.rows.flatMap(row => {
    const metricId = String(row.metric_id ?? "");
    const value = Number(row.value);
    if (!dashboardReleaseTarget(metricId) || !Number.isFinite(value)) return [];
    const change = row.change_vs_prior_release == null ? 0 : Number(row.change_vs_prior_release);
    return [{ id: Number(row.id), metricId, periodDate: String(row.period_date), releasedAt: String(row.released_at), value,
      stage: releaseStageFromNote(row.notes == null ? null : String(row.notes)) ?? (Number.isFinite(change) && change !== 0 ? "revised" : null) }];
  });
  return { cursor: result.rows.length ? Number(result.rows[result.rows.length - 1].id) : after, updates, hasMore: result.rows.length === 250 };
}
