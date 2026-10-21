import type { IndicatorSpec, Region } from './macro-ui-hierarchy';

const US_PRIMARY = new Set(['us-cpi-card', 'us-core-cpi-card', 'us-pce-card', 'us-core-pce-card', 'us-ppi-card']);

export function priceStudioSpecs(region: Region, specs: IndicatorSpec[]): IndicatorSpec[] {
  return region === 'US' ? specs.filter(spec => US_PRIMARY.has(spec.id)) : specs;
}

export function ppiComparisonSpecs(card: IndicatorSpec | undefined): IndicatorSpec[] {
  return (card?.components ?? []).flatMap(node => node.metricId ? [{
    id: node.metricId, title: node.label, metricId: node.metricId, yoyMetricId: node.metricId,
    momMetricId: node.momMetricId,
    components: node.children,
    groupOnly: node.groupOnly,
    chartMetricIds: node.chartMetricIds,
  }] : []);
}

/** Keep non-additive groups as explicit component lines, never as a proxy total. */
export function inflationPlotSpecs(specs: IndicatorSpec[]): IndicatorSpec[] {
  return specs.flatMap(spec => spec.groupOnly ? (spec.components ?? [])
    .filter(node => node.metricId && spec.chartMetricIds?.includes(node.metricId))
    .map(node => ({ id: node.metricId!, metricId: node.metricId!, title: node.label,
      yoyMetricId: node.metricId, momMetricId: node.momMetricId })) : [spec]);
}
