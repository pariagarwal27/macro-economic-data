import { contributionRate, type ContributionMetrics, type ContributionMode } from "./inflation-contributions";

export const PCE_RATE_SOURCES: Record<string, { indexId: string; mode: ContributionMode }> = {
  "us-pce-mom": { indexId: "us-pce", mode: "mom" },
  "us-pce-yoy": { indexId: "us-pce", mode: "yoy" },
  "us-core-pce-mom": { indexId: "us-core-pce", mode: "mom" },
  "us-core-pce-yoy": { indexId: "us-core-pce", mode: "yoy" },
};

/** Use the same index vintage as the component chart, ahead of cached rate rows. */
export function pceRate(metrics: ContributionMetrics, core: boolean, period: string, mode: ContributionMode) {
  const indexId = core ? "us-core-pce" : "us-pce";
  return contributionRate(metrics[indexId], period, mode)
    ?? contributionRate(metrics[`${indexId}-${mode}`], period, mode, mode);
}

export function isPceMonthlySeries(metric: { source: string; seriesId: string; frequency: string }) {
  return metric.source === "bea" && metric.frequency === "monthly" && /^T2080[45]:/.test(metric.seriesId);
}

/** The monthly Personal Income and Outlays release reports the preceding month. */
export function expectedPcePeriod(scheduledAt: string) {
  const date = scheduledAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return null;
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}
