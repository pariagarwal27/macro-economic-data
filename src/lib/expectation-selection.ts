export type ExpectationMetricSelection = {
  metricId: string;
  children: [];
};

export function createExpectationMetricSelection(metricId: string): ExpectationMetricSelection {
  return { metricId, children: [] };
}
