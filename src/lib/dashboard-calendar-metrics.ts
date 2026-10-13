import { METRICS } from '@/catalog/metrics';
import { DASHBOARD } from '@/components/macro-ui-hierarchy';
import { calendarMetricName, shouldShowCalendarMetric } from './economic-calendar-metrics';

/** Top-level dashboard series plus daily/hourly metrics, which publish continuously. */
export function getDashboardCalendarMetrics() {
  const displayed = new Set<string>();
  const titles = new Map<string, string>();
  for (const categories of Object.values(DASHBOARD)) {
    for (const spec of Object.values(categories).flat()) {
      for (const id of [spec.metricId, spec.yoyMetricId, spec.momMetricId, ...(spec.chartMetricIds ?? [])]) {
        if (id) displayed.add(id);
      }
      if (spec.title) titles.set(spec.metricId, spec.title);
    }
  }
  const visibleMetrics = METRICS.filter(metric =>
    (displayed.has(metric.id) || metric.frequency === "daily" || metric.frequency === "hourly") &&
    shouldShowCalendarMetric(metric, METRICS),
  );
  return visibleMetrics.map(metric => ({
    ...metric,
    name: titles.get(metric.id) ?? calendarMetricName(metric),
  }));
}
