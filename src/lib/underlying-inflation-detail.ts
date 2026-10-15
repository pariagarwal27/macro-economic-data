import type { IndicatorSpec } from "@/components/macro-ui-hierarchy";
type MetricPoint = { date: string; value: number };

export type UnderlyingInflationRatePair = {
  yoy: number | null;
  mom: number | null;
};

export type UnderlyingInflationHistories = Record<
  string,
  Array<MetricPoint> | undefined
>;

const UNDERLYING_INFLATION_DETAIL_IDS = new Set([
  "us-sticky-cpi",
  "us-core-sticky-cpi",
  "us-flexible-cpi",
  "us-cleveland-median-cpi",
  "us-cleveland-trimmed-cpi",
]);

export function normalizeUnderlyingInflationDetailSpec(spec: IndicatorSpec): IndicatorSpec {
  const baseId = spec.metricId.endsWith("-mom")
    ? spec.metricId.slice(0, -4)
    : spec.metricId;
  if (!UNDERLYING_INFLATION_DETAIL_IDS.has(baseId)) return spec;

  return {
    ...spec,
    id: baseId,
    metricId: baseId,
    yoyMetricId: baseId,
    momMetricId: `${baseId}-mom`,
  };
}

/** Select the source-published rate levels; never derive changes from YoY rates. */
export function getUnderlyingInflationPublishedRates(
  spec: IndicatorSpec,
  histories: UnderlyingInflationHistories
): UnderlyingInflationRatePair | null {
  const baseId = spec.metricId.endsWith("-mom")
    ? spec.metricId.slice(0, -4)
    : spec.metricId;
  if (!UNDERLYING_INFLATION_DETAIL_IDS.has(baseId)) return null;

  const latestValue = (points: MetricPoint[] | undefined) =>
    [...(points ?? [])]
      .filter((point) =>
        Number.isFinite(Number(point.value)) && /^\d{4}-\d{2}/.test(point.date)
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.value ?? null;

  return {
    yoy: latestValue(histories[baseId]),
    mom: latestValue(histories[`${baseId}-mom`]),
  };
}
