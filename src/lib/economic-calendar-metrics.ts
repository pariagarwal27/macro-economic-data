import type { MetricDef } from "@/catalog/metrics";

const isRateTransform = (metric: MetricDef) =>
  metric.transform === "pct_change" || metric.transform === "pct_change_mom" || metric.transform === "pct_change_yoy" || metric.transform === "published_rate";

/** Avoid showing a raw index when this same official series is represented by a released rate. */
export function shouldShowCalendarMetric(metric: MetricDef, catalog: MetricDef[]) {
  if (metric.frequency === "daily" || metric.frequency === "hourly") return true;
  if (metric.unit !== "index" || isRateTransform(metric)) return true;
  return !catalog.some(candidate => candidate.id !== metric.id && candidate.region === metric.region &&
    candidate.releaseName === metric.releaseName && candidate.seriesId === metric.seriesId &&
    candidate.frequency === metric.frequency && candidate.unit === "percent" && isRateTransform(candidate));
}

/** Make calculated-rate rows explicit while leaving native levels and published horizon measures intact. */
export function calendarMetricName(metric: MetricDef) {
  if (metric.frequency === "daily" || metric.frequency === "hourly") return metric.name;
  const suffix = metric.transform === "pct_change_mom" ? "MoM" : metric.transform === "pct_change_yoy" ? "YoY" : null;
  if (!suffix || new RegExp(`\\b${suffix}\\b`, "i").test(metric.name)) return metric.name;
  return `${metric.name} ${suffix}`;
}
