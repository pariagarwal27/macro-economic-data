import { METRICS } from '@/catalog/metrics';
import { DASHBOARD, type Region } from '@/components/macro-ui-hierarchy';
import { calendarMetricName, shouldShowCalendarMetric } from './economic-calendar-metrics';

const UK_INFLATION_CARDS_HIDDEN_FROM_FRONT = new Set([
  'uk-food-card',
  'uk-goods-card',
  'uk-housing-card',
]);

/** Front-card series, their published rate pairs, and continuous metrics. */
export function getDashboardCalendarMetrics() {
  const displayed = new Set<string>();
  const titles = new Map<string, string>();
  for (const [region, categories] of Object.entries(DASHBOARD) as [Region, typeof DASHBOARD[Region]][]) {
    for (const spec of Object.values(categories).flat()) {
      if (region === 'UK' && UK_INFLATION_CARDS_HIDDEN_FROM_FRONT.has(spec.id)) continue;

      for (const id of [spec.metricId, spec.yoyMetricId, spec.momMetricId]) {
        if (id) displayed.add(id);
      }
      if (region === 'UK' && spec.title) {
        if (spec.yoyMetricId) titles.set(spec.yoyMetricId, `${spec.title} YoY`);
        if (spec.momMetricId) titles.set(spec.momMetricId, `${spec.title} MoM`);
      } else if (spec.title) {
        titles.set(spec.metricId, spec.title);
      }
    }
  }
  // The claims card displays two separately published weekly readings.
  // Keep both in the release diary rather than only the card's primary metric.
  for (const id of ['us-initial-claims', 'us-continuing-claims']) {
    displayed.add(id);
    const metric = METRICS.find(item => item.id === id);
    if (metric) titles.set(id, metric.name);
  }
  // PCE diary rows should report published inflation rates, not price-index levels.
  for (const [id, name] of [
    ['us-pce-mom', 'PCE (Headline) MoM'],
    ['us-pce-yoy', 'PCE (Headline) YoY'],
    ['us-core-pce-yoy', 'PCE (Core) YoY'],
    ['us-core-pce-mom', 'PCE (Core) MoM'],
  ]) {
    displayed.add(id);
    titles.set(id, name);
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
