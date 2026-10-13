export type MiniHistoryPoint = { date: string; value: number };
export type MiniMetric = {
  history: MiniHistoryPoint[];
  meta: { id: string; transform?: string; frequency?: string };
} | undefined;

export type MiniMeasure = "raw" | "mom" | "yoy";

function relatedMeasureId(metricId: string, measure: "mom" | "yoy") {
  if (measure === "mom" && /-yoy$/.test(metricId)) return metricId.replace(/-yoy$/, "-mom");
  if (measure === "yoy" && /-qoq$/.test(metricId)) return metricId.replace(/-qoq$/, "-yoy");
  return undefined;
}

function calculateLevelRate(history: MiniHistoryPoint[], frequency: string | undefined, measure: "mom" | "yoy") {
  const isQuarterly = frequency === "quarterly";
  const periodIndex = (date: string) => {
    const quarter = date.match(/^(\d{4})[- ]?Q([1-4])$/i);
    if (quarter) return Number(quarter[1]) * 4 + Number(quarter[2]) - 1;
    const month = date.match(/^(\d{4})-(\d{2})/);
    if (!month) return null;
    const monthNumber = Number(month[2]);
    if (monthNumber < 1 || monthNumber > 12) return null;
    return isQuarterly
      ? Number(month[1]) * 4 + Math.floor((monthNumber - 1) / 3)
      : Number(month[1]) * 12 + monthNumber - 1;
  };
  const priorPeriods = new Map(history.flatMap(point => {
    const key = periodIndex(point.date);
    return key == null ? [] : [[key, point.value] as const];
  }));
  const lag = measure === "mom" ? 1 : isQuarterly ? 4 : 12;
  return history.flatMap(point => {
    const key = periodIndex(point.date);
    const prior = key == null ? undefined : priorPeriods.get(key - lag);
    if (prior == null || !Number.isFinite(point.value) || !Number.isFinite(prior) || prior === 0) return [];
    return [{ date: point.date, value: (point.value / prior - 1) * 100 }];
  });
}

/** Choose the matching measure for a component sparkline, deriving it from levels only when needed. */
export function selectComponentMiniSeries(
  node: { metricId?: string; momMetricId?: string },
  metric: MiniMetric,
  allMetrics: Record<string, MiniMetric>,
  measure: MiniMeasure,
): { metricId: string | undefined; frequency: string | undefined; data: MiniHistoryPoint[] } {
  if (!metric) return { metricId: undefined, frequency: undefined, data: [] };
  if (measure === "raw") return { metricId: metric.meta.id, frequency: metric.meta.frequency, data: metric.history };

  const counterpartId = measure === "mom"
    ? node.momMetricId ?? relatedMeasureId(metric.meta.id, "mom")
    : relatedMeasureId(metric.meta.id, "yoy");
  const counterpart = counterpartId ? allMetrics[counterpartId] : undefined;
  if (counterpart?.history.length) {
    return { metricId: counterpart.meta.id, frequency: counterpart.meta.frequency, data: counterpart.history };
  }

  if (metric.meta.transform === "level" || metric.meta.transform === "index") {
    return {
      metricId: metric.meta.id,
      frequency: metric.meta.frequency,
      data: calculateLevelRate(metric.history, metric.meta.frequency, measure),
    };
  }

  const isAlreadyMeasure = measure === "mom"
    ? metric.meta.transform === "pct_change_mom" || /-mom$/.test(metric.meta.id)
    : metric.meta.transform === "pct_change_yoy" || /-yoy$/.test(metric.meta.id);
  return {
    metricId: metric.meta.id,
    frequency: metric.meta.frequency,
    data: isAlreadyMeasure ? metric.history : [],
  };
}
