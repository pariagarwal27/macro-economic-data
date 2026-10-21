import { US_PPI_RELEASE_PAIRS } from '../catalog/us-ppi.mjs';

const PUBLISHED_COMPONENT_MEASURE_PAIRS: Record<string, string> = {
  ...US_PPI_RELEASE_PAIRS,
  "ea-food-hicp-yoy": "ea-food-hicp-mom",
  "ea-energy-hicp-yoy": "ea-energy-hicp-mom",
  "ea-goods-hicp-yoy": "ea-goods-hicp-mom",
};

export function getPublishedComponentMeasureIds(metricId: string) {
  const momMetricId = PUBLISHED_COMPONENT_MEASURE_PAIRS[metricId]
    ?? (metricId.startsWith("uk-ppi-") && metricId.endsWith("-yoy")
      ? metricId.replace(/-yoy$/, "-mom")
      : undefined);
  return momMetricId ? { yoyMetricId: metricId, momMetricId } : null;
}
