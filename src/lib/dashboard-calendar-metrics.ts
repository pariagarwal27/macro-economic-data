import { METRICS } from '@/catalog/metrics';
import { DASHBOARD } from '@/components/macro-ui-hierarchy';

/** Dashboard series plus every daily/hourly metric, which publishes continuously. */
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
  return METRICS.filter(metric => displayed.has(metric.id) || metric.frequency === "daily" || metric.frequency === "hourly").map(metric => ({
    ...metric, name: titles.get(metric.id) ?? metric.name,
  }));
}
