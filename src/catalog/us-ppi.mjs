import manifest from './us-ppi-series.json' with { type: 'json' };

export const US_PPI_SERIES = manifest.series.map(series => ({
  ...series,
  id: series.key === 'headline' ? 'us-ppi-final-demand' : series.key === 'core' ? 'us-ppi-core' : `us-ppi-${series.key}-yoy`,
  momId: series.key === 'headline' ? 'us-ppi-final-demand-mom' : series.key === 'core' ? 'us-ppi-core-mom' : `us-ppi-${series.key}-mom`,
  saSeriesId: series.seriesId.replace(/^WPU/, 'WPS'),
}));
export const US_PPI_METRIC_IDS = US_PPI_SERIES.flatMap(series => [series.id, series.momId]);
export const US_PPI_RELEASE_PAIRS = Object.fromEntries(US_PPI_SERIES.map(series => [series.id, series.momId]));

/** @typedef {{ id: string, label: string, metricId: string, momMetricId: string, children?: PpiNode[] }} PpiNode */
/** @param {string} key @returns {PpiNode} */
function node(key) {
  const series = US_PPI_SERIES.find(item => item.key === key);
  if (!series) throw new Error(`Unknown US PPI category ${key}`);
  return { id: `us-ppi-${key}`, label: series.label, metricId: series.id, momMetricId: series.momId,
    ...series.children?.length ? { children: series.children.map(node) } : {} };
}
export const US_PPI_COMPONENTS = [
  { ...node('headline'), label: 'Final Demand', children: [...(node('headline').children ?? []), node('core')] },
  {
    id: 'us-ppi-intermediate-demand', label: 'Intermediate Demand',
    // This anchor supplies shared source/period metadata only. It is never
    // presented as an overall Intermediate Demand index, which BLS does not publish.
    metricId: 'us-ppi-intermediate-processed-goods-yoy',
    momMetricId: 'us-ppi-intermediate-processed-goods-mom',
    groupOnly: true,
    chartMetricIds: ['us-ppi-intermediate-processed-goods-yoy', 'us-ppi-intermediate-unprocessed-goods-yoy', 'us-ppi-intermediate-services-yoy', 'us-ppi-intermediate-construction-yoy'],
    children: manifest.main.filter(key => key.startsWith('intermediate-')).map(node),
  },
];
