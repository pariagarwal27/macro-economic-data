import { METRICS } from '@/catalog/metrics';
import { DASHBOARD } from '@/components/macro-ui-hierarchy';
import { calendarMetricName, shouldShowCalendarMetric } from './economic-calendar-metrics';

/** Top-level dashboard series, the paired claims readings, and continuous metrics. */
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
  // The claims card displays two separately published weekly readings.
  // Keep both in the release diary rather than only the card's primary metric.
  for (const id of ['us-initial-claims', 'us-continuing-claims']) {
    displayed.add(id);
    const metric = METRICS.find(item => item.id === id);
    if (metric) titles.set(id, metric.name);
  }
  for (const id of ["us-sticky-cpi", "us-core-sticky-cpi", "us-flexible-cpi", "us-cleveland-median-cpi", "us-cleveland-trimmed-cpi"]) {
    displayed.add(id);
    const metric = METRICS.find(item => item.id === id);
    if (metric) titles.set(id, metric.name);
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
