import { METRICS } from '@/catalog/metrics';
import { DASHBOARD } from '@/components/macro-ui-hierarchy';

/** Only the series displayed on dashboard cards, across all three countries. */
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
  return METRICS.filter(metric => displayed.has(metric.id)).map(metric => ({
    ...metric, name: titles.get(metric.id) ?? metric.name,
  }));
}
