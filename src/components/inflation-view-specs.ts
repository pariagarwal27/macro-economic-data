import type { IndicatorSpec, Region } from './macro-ui-hierarchy';

const US_PRIMARY = new Set(['us-cpi-card', 'us-core-cpi-card', 'us-pce-card', 'us-core-pce-card', 'us-ppi-card']);

export function priceStudioSpecs(region: Region, specs: IndicatorSpec[]): IndicatorSpec[] {
  return region === 'US' ? specs.filter(spec => US_PRIMARY.has(spec.id)) : specs;
}

export function ppiComparisonSpecs(card: IndicatorSpec | undefined): IndicatorSpec[] {
  // The US PPI release's two headline measures are Final Demand and Final
  // Demand less foods, energy, and trade services. Keep Intermediate Demand
  // available in the component drilldown, but do not present it as the second
  // top-level inflation measure.
  const usHeadline = (card?.components ?? []).find(node => node.metricId === 'us-ppi-final-demand');
  if (usHeadline) {
    const headline = usHeadline;
    const core = headline.children?.find(node => node.metricId === 'us-ppi-core');
    return [headline, ...(core ? [core] : [])].map(node => ({
      id: node.metricId!, title: node.metricId === 'us-ppi-core' ? 'Core PPI' : 'Headline PPI',
      metricId: node.metricId!, yoyMetricId: node.metricId!, momMetricId: node.momMetricId,
      components: node.children,
    }));
  }
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
