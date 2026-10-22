import type { MetricDef } from "@/catalog/metrics";

export type TrendPoint = { date: string; value: number; rawValue?: number | null };
export type ThreeMonthTrend = {
  label: string;
  note: string;
  frequency: MetricDef["frequency"];
  history: TrendPoint[];
};
export type ThreeMonthMethod = "published-saar" | "published-3m3m" | "rolling-3m3m-index" | "saar-3m3m" | "moving-average" | "published-average" | "not-applicable";

export type ThreeMonthMethodEntry = {
  method: ThreeMonthMethod;
  label: string;
  frequency: MetricDef["frequency"];
  seasonallyAdjusted: boolean;
  sourceMetricIds: string[];
  notApplicableReason?: string;
};

function monthOffset(date: string, offset: number): string {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthlyMap(points: TrendPoint[]) {
  return new Map(points.map((point) => [point.date.slice(0, 7), point.value]));
}

function contiguousMonthlyWindow(
  values: Map<string, number>,
  date: string,
  count: number
): number[] | null {
  const anchor = date.slice(0, 7);
  const window: number[] = [];
  for (let lag = count - 1; lag >= 0; lag -= 1) {
    const value = values.get(monthOffset(anchor, -lag));
    if (value == null || !Number.isFinite(value)) return null;
    window.push(value);
  }
  return window;
}

function annualizedThreeMonthRates(points: TrendPoint[]): TrendPoint[] {
  const values = monthlyMap(points);
  return points.flatMap((point) => {
    const window = contiguousMonthlyWindow(values, point.date, 3);
    if (!window) return [];
    const compounded = window.reduce((acc, rate) => acc * (1 + rate / 100), 1);
    const annualized = (Math.pow(compounded, 4) - 1) * 100;
    return Number.isFinite(annualized) ? [{ date: point.date, value: annualized }] : [];
  });
}

function annualizedThreeMonthIndex(points: TrendPoint[]): TrendPoint[] {
  // Eurostat retail observations retain the source volume-index level in
  // rawValue while value contains the published month-on-month rate.
  const values = new Map(points.map((point) => [point.date.slice(0, 7), point.rawValue ?? point.value]));
  return points.flatMap((point) => {
    const window = contiguousMonthlyWindow(values, point.date, 4);
    if (!window || window[0] === 0) return [];
    const rate = (Math.pow(window[3]! / window[0]!, 4) - 1) * 100;
    return Number.isFinite(rate) ? [{ date: point.date, value: rate }] : [];
  });
}

function rollingThreeMonthIndexChange(points: TrendPoint[]): TrendPoint[] {
  const values = monthlyMap(points);
  return points.flatMap((point) => {
    const current = contiguousMonthlyWindow(values, point.date, 3);
    const prior = contiguousMonthlyWindow(values, monthOffset(point.date, -3), 3);
    if (!current || !prior) return [];
    const currentAverage = current.reduce((sum, value) => sum + value, 0) / 3;
    const priorAverage = prior.reduce((sum, value) => sum + value, 0) / 3;
    if (priorAverage === 0) return [];
    const value = (currentAverage / priorAverage - 1) * 100;
    return Number.isFinite(value) ? [{ date: point.date, value }] : [];
  });
}

function monthlyAverage(points: TrendPoint[], periods = 3): TrendPoint[] {
  const values = monthlyMap(points);
  return points.flatMap((point) => {
    const window = contiguousMonthlyWindow(values, point.date, periods);
    if (!window) return [];
    return [{ date: point.date, value: window.reduce((sum, value) => sum + value, 0) / periods }];
  });
}

function isSeasonallyAdjusted(metric: MetricDef): boolean {
  const id = metric.seriesId.toUpperCase();
  // BEA's PCE price index table (including the catalog's PCE subindexes)
  // publishes monthly index numbers seasonally adjusted. The catalog's series
  // ids (T20804:*) and descriptions do not carry a generic SA suffix, so mark
  // them explicitly; otherwise the generic moving-average path averages index
  // levels and displays values around 100 instead of an inflation rate.
  const isBeaPcePriceIndex = metric.source === "bea" &&
    (metric.seriesId.toUpperCase().startsWith("T20804:") ||
      metric.id.startsWith("us-pce") || metric.id === "us-core-pce") &&
    metric.transform === "level" &&
    metric.unit === "index";
  return /seasonally adjusted|\bSA\b/i.test(metric.description) ||
    isBeaPcePriceIndex ||
    id.startsWith("CUSR") || id.startsWith("WPS") || id.startsWith("CES") ||
    /(?:SA|SL|SAS|SASL)$/.test(id);
}

/** Explicit method map for supported US, UK and Euro Area series. */
export function buildThreeMonthMethodMap(metrics: MetricDef[]): Map<string, ThreeMonthMethodEntry> {
  const supportedMetrics = metrics.filter((metric) => metric.region === "US" || metric.region === "UK" || metric.region === "EA");
  const byId = new Map(supportedMetrics.map((metric) => [metric.id, metric]));
  const result = new Map<string, ThreeMonthMethodEntry>();

  for (const metric of supportedMetrics) {
    const seasonallyAdjusted = isSeasonallyAdjusted(metric);
    const momId = metric.transform === "pct_change_yoy" ||
      (metric.region === "EA" && metric.subcategory === "producer_prices" && metric.id.endsWith("-yoy")) ||
      (metric.region === "UK" && metric.id === "uk-awe-regular-yoy")
      ? metric.id.endsWith("-yoy")
        ? metric.id.replace(/-yoy$/, "-mom")
        : metric.id.startsWith("us-ppi-")
          ? `${metric.id}-mom`
          : ""
      : "";
    const momMetric = momId ? byId.get(momId) : undefined;
    let entry: ThreeMonthMethodEntry;

    if (metric.region === "EA" && metric.id === "ea-retail-sales-total-ex-motor-vehicles") {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [metric.id] };
    } else if (metric.region === "EA" && metric.id === "ea-retail-sales-ex-fuel") {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [metric.id] };
    } else if (metric.region === "EA" && metric.id === "ea-wage-growth") {
      entry = { method: "published-3m3m", label: "QoQ (3m/3m)", frequency: metric.frequency, seasonallyAdjusted: false, sourceMetricIds: ["ea-wage-growth-qoq"] };
    } else if (metric.region === "EA" && metric.frequency === "monthly" && metric.transform === "published_rate" && metric.category === "inflation" && /(?:hicp|inflation|ppi).*yoy|yoy.*(?:hicp|inflation|ppi)/i.test(`${metric.id} ${metric.name}`)) {
      entry = { method: "moving-average", label: "3-month avg YoY", frequency: metric.frequency, seasonallyAdjusted: false, sourceMetricIds: [metric.id] };
    } else if (metric.region === "EA" && metric.category === "jobs" && metric.frequency === "monthly" && metric.transform === "published_rate") {
      entry = { method: "moving-average", label: "3-month average", frequency: metric.frequency, seasonallyAdjusted: false, sourceMetricIds: [metric.id] };
    } else if (metric.region === "UK" && metric.id === "uk-retail-sales-total-ex-fuel") {
      entry = { method: "published-3m3m", label: "3m/3m", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: ["uk-retail-sales-total-3m3m"] };
    } else if (metric.region === "UK" && metric.id === "uk-retail-sales-ex-fuel") {
      entry = { method: "published-3m3m", label: "3m/3m", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: ["uk-retail-sales-ex-fuel-3m3m"] };
    } else if (metric.region === "EA" && metric.category === "inflation" && metric.subcategory === "producer_prices" && metric.transform === "published_rate" && momMetric) {
      // Eurostat PPI month-on-month rates are published for the matching
      // indicator and can be compounded into an annualized three-month rate.
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: false, sourceMetricIds: [momMetric.id] };
    } else if (metric.region === "UK" && metric.id === "uk-awe-regular-yoy" && momMetric) {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [momMetric.id] };
    } else if (metric.region === "UK" && metric.category === "inflation" && metric.subcategory === "producer_prices" && metric.transform === "pct_change_yoy" && momMetric) {
      // ONS PPI is not seasonally adjusted. Retain the requested annualized
      // three-month rate, and disclose the NSA source in the trend note.
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: false, sourceMetricIds: [momMetric.id] };
    } else if (metric.region === "UK" && metric.id === "uk-gdp-qoq") {
      entry = {
        method: "not-applicable",
        label: "",
        frequency: metric.frequency,
        seasonallyAdjusted: true,
        sourceMetricIds: [],
        notApplicableReason: "UK real GDP is displayed using its published quarterly latest and prior readings.",
      };
    } else if (metric.region === "UK" && metric.id.endsWith("-3m3m")) {
      entry = { method: "not-applicable", label: "", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [] };
    } else if (metric.region === "UK" && metric.frequency === "monthly") {
      entry = { method: "moving-average", label: "3-month average", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id] };
    } else if (metric.region !== "US") {
      entry = {
        method: "not-applicable",
        label: "",
        frequency: metric.frequency,
        seasonallyAdjusted,
        sourceMetricIds: [],
        notApplicableReason: "No published three-month series is configured for this metric.",
      };
    } else if (metric.id === "us-gdp-real") {
      entry = { method: "published-saar", label: "QoQ SAAR", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [metric.id] };
    } else if (metric.frequency === "weekly" && metric.id === "us-initial-claims") {
      entry = { method: "published-average", label: "4-week moving average", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id, "us-initial-claims-4wk-average"] };
    } else if (metric.frequency === "weekly" && metric.id === "us-continuing-claims") {
      entry = { method: "published-average", label: "4-week moving average", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id, "us-continuing-claims-4wk-average"] };
    } else if (metric.frequency === "monthly" && metric.id.startsWith("us-retail-sales") && metric.transform === "pct_change_mom") {
      // Census/FRED retail series are seasonally adjusted monthly rates even
      // where the local metric description omits the adjustment flag. Compose
      // the three published monthly changes and annualize to get 3m/3m SAAR.
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [metric.id] };
    } else if (metric.frequency === "monthly" && metric.transform === "pct_change_mom" && seasonallyAdjusted) {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id] };
    } else if (metric.frequency === "monthly" && metric.transform === "pct_change_yoy" && momMetric && isSeasonallyAdjusted(momMetric)) {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted: true, sourceMetricIds: [momMetric.id] };
    } else if (metric.frequency === "monthly" && metric.id.startsWith("us-retail-sales") && seasonallyAdjusted) {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id] };
    } else if (metric.frequency === "monthly" && (metric.transform === "index" || (metric.transform === "level" && metric.unit === "index")) && seasonallyAdjusted) {
      entry = { method: "saar-3m3m", label: "3m/3m SAAR", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id] };
    } else if (metric.frequency === "monthly") {
      entry = { method: "moving-average", label: "3-month average", frequency: metric.frequency, seasonallyAdjusted, sourceMetricIds: [metric.id] };
    } else {
      entry = {
        method: "not-applicable",
        label: "",
        frequency: metric.frequency,
        seasonallyAdjusted,
        sourceMetricIds: [],
        notApplicableReason: "No suitable monthly or weekly official series is configured for this metric.",
      };
    }
    result.set(metric.id, entry);
  }

  return result;
}

/** Build a derived display series without changing stored or published values. */
export function buildThreeMonthTrend(
  metric: MetricDef,
  history: TrendPoint[],
  method: ThreeMonthMethodEntry,
  companionPublishedHistory?: TrendPoint[]
): ThreeMonthTrend | null {
  if ((metric.region !== "US" && metric.region !== "UK" && metric.region !== "EA") || history.length === 0 || method.method === "not-applicable") return null;

  if (method.method === "published-3m3m" && companionPublishedHistory?.length) {
    return {
      label: method.label,
      note: "Official ONS seasonally adjusted rolling three-month change compared with the previous three months.",
      frequency: method.frequency,
      history: companionPublishedHistory,
    };
  }

  if (method.method === "rolling-3m3m-index" && companionPublishedHistory?.length) {
    return {
      label: method.label,
      note: "ONS seasonally adjusted monthly GDP index change: average of the latest three months compared with the previous three months.",
      frequency: method.frequency,
      history: rollingThreeMonthIndexChange(companionPublishedHistory),
    };
  }

  // BEA reports real GDP quarter-over-quarter changes at annual rates already.
  // Preserve its published series; applying another annualization would be wrong.
  if (method.method === "published-saar") {
    return {
      label: method.label,
      note: "BEA publishes quarterly GDP growth at an annual rate; values are unchanged.",
      frequency: method.frequency,
      history,
    };
  }

  if (method.method === "published-average") {
    if (!companionPublishedHistory?.length) return null;
    return {
      label: method.label,
      note: "Official seasonally adjusted 4-week moving average published in the U.S. Department of Labor weekly claims release.",
      frequency: method.frequency,
      history: companionPublishedHistory,
    };
  }

  // BEA Table 2.8.4 series are seasonally adjusted price-index levels. Always
  // derive the 3m/3m rate from those levels, including Core PCE (T20804:25),
  // even if a stored/catalog transform is stale or mislabeled as a rate.
  if (method.method === "saar-3m3m" && metric.source === "bea" &&
      metric.seriesId.toUpperCase().startsWith("T20804:")) {
    return {
      label: method.label,
      note: "Annualized change in the BEA seasonally adjusted price index over three months.",
      frequency: method.frequency,
      history: annualizedThreeMonthIndex(history),
    };
  }

  if (method.method === "saar-3m3m" && metric.region === "EA" && metric.category === "growth") {
    return {
      label: method.label,
      note: "Annualized change in the official seasonally and calendar-adjusted Eurostat retail volume index over three months.",
      frequency: method.frequency,
      history: annualizedThreeMonthIndex(history),
    };
  }

  if (method.method === "saar-3m3m" && metric.transform === "pct_change_mom") {
    return {
      label: method.label,
      note: "Compounded change across the latest three seasonally adjusted monthly rates, annualized.",
      frequency: method.frequency,
      history: annualizedThreeMonthRates(history),
    };
  }

  if (method.method === "saar-3m3m" && metric.transform === "pct_change_yoy" && companionPublishedHistory?.length) {
    return {
      label: method.label,
      note: metric.region === "UK" && metric.subcategory === "producer_prices"
        ? "Annualized change compounded from three published monthly ONS PPI rates. The underlying series is not seasonally adjusted."
        : "Calculated from the corresponding seasonally adjusted monthly series.",
      frequency: method.frequency,
      history: annualizedThreeMonthRates(companionPublishedHistory),
    };
  }

  if (method.method === "saar-3m3m" && metric.region === "EA" && metric.subcategory === "producer_prices" && companionPublishedHistory?.length) {
    return {
      label: method.label,
      note: "Annualized change compounded from three published monthly Eurostat PPI rates. The underlying Euro Area PPI series is not seasonally adjusted, so seasonal effects remain.",
      frequency: method.frequency,
      history: annualizedThreeMonthRates(companionPublishedHistory),
    };
  }

  if (method.method === "saar-3m3m" && metric.region === "UK" && metric.id === "uk-awe-regular-yoy" && companionPublishedHistory?.length) {
    return {
      label: method.label,
      note: "Annualized change compounded from three monthly changes in the seasonally adjusted ONS AWE regular-pay index.",
      frequency: method.frequency,
      history: annualizedThreeMonthRates(companionPublishedHistory),
    };
  }

  const isSeasonallyAdjustedIndex = method.method === "saar-3m3m" &&
    (metric.transform === "index" || (metric.transform === "level" && metric.unit === "index"));
  if (isSeasonallyAdjustedIndex) {
    return {
      label: method.label,
      note: "Annualized change in the published monthly index/level over three months.",
      frequency: method.frequency,
      history: annualizedThreeMonthIndex(history),
    };
  }

  if (method.method === "moving-average") {
    return {
      label: method.label,
      note: "Arithmetic average of the latest three consecutive monthly observations.",
      frequency: method.frequency,
      history: monthlyAverage(history),
    };
  }

  return null;
}
