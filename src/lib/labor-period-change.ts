type Reading = { date: string; value: number };
export type LaborChangePoint = { date: string; value: number | null };

const CHANGE_METRICS = new Set([
  "us-payrolls-level", "us-participation", "us-jolts-openings",
  "uk-employment-level", "uk-vacancies", "uk-payrolled-employees-level",
]);

export function isLaborChangeMetric(id?: string): boolean {
  return CHANGE_METRICS.has(id ?? "");
}

/** Difference adjacent monthly periods before applying any chart date window. */
export function laborPeriodChanges(history: readonly Reading[]): LaborChangePoint[] {
  const periods = new Map<number, Reading>();
  for (const point of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    const match = point.date.match(/^(\d{4})-(\d{2})/);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) continue;
    periods.set(Number(match[1]) * 12 + Number(match[2]) - 1, point);
  }
  return [...periods].slice(1).map(([period, point]) => {
    const prior = periods.get(period - 1);
    const value = prior && Number.isFinite(prior.value) && Number.isFinite(point.value)
      ? Number((point.value - prior.value).toFixed(10))
      : null;
    return { date: point.date.slice(0, 10), value };
  });
}

export function laborChangeKpis(id: string, history: readonly Reading[]) {
  if (!isLaborChangeMetric(id)) return null;
  return {
    mode: "absolute-change" as const,
    leftLabel: id === "uk-employment-level" || id === "uk-vacancies" ? "Change vs prior period" : "Monthly Change",
    leftValue: laborPeriodChanges(history).at(-1)?.value ?? null,
    rightLabel: "",
    rightValue: null,
    showRight: false,
  };
}

/** Published readings show the actual observations, independently of chart measure. */
export function laborPublishedKpis(id: string, history: readonly Reading[]) {
  if (!isLaborChangeMetric(id)) return null;
  const readings = [...history].sort((a, b) => a.date.localeCompare(b.date));
  return {
    mode: id === "us-participation" ? "rate" as const : "level" as const,
    leftLabel: "Latest",
    leftValue: readings.at(-1)?.value ?? null,
    rightLabel: "Prior",
    rightValue: readings.at(-2)?.value ?? null,
    showRight: true,
  };
}

export function formatLaborChange(value: number | null | undefined, metric: { id: string; unit?: string }): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  if (metric.id === "us-participation") return `${sign}${value.toFixed(1)} pp`;
  if (metric.unit?.toLowerCase().includes("thousand")) return `${sign}${Math.round(value)}K`;
  if (Math.abs(value) >= 1000) return `${sign}${Number((value / 1000).toFixed(1))}K`;
  return `${sign}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
