import { getNiceTickDomain, getNiceTicks, getTickPrecision } from "./chart-axis";

export type OverviewRegion = "US" | "UK" | "EA";
export type OverviewIndicator = "inflation" | "gdp" | "unemployment" | "wage" | "retail";
export type OverviewObservation = { date: string; value: number; rawValue?: number | null };
export type OverviewPayload = Record<string, {
  history: OverviewObservation[];
  meta?: { liveSource?: string | null; name?: string; unit?: string; frequency?: string };
} | null>;
export type OverviewChartPoint = { date: string; period: string; label: string; US: number | null; UK: number | null; EA: number | null; [key: string]: string | number | null };
export type OverviewInflationMode = "yoy" | "mom";
export type OverviewInflationSeries = { key: string; region: OverviewRegion; kind: "headline" | "core"; metricLabel: string };
export type OverviewInflationPoint = { date: string; period: string; label: string } & Record<string, number | string | null>;

export const OVERVIEW_INFLATION_SERIES: OverviewInflationSeries[] = [
  { key: "usHeadline", region: "US", kind: "headline", metricLabel: "CPI" },
  { key: "ukHeadline", region: "UK", kind: "headline", metricLabel: "CPI" },
  { key: "eaHeadline", region: "EA", kind: "headline", metricLabel: "HICP" },
  { key: "usCore", region: "US", kind: "core", metricLabel: "Core CPI" },
  { key: "ukCore", region: "UK", kind: "core", metricLabel: "Core CPI" },
  { key: "eaCore", region: "EA", kind: "core", metricLabel: "Core HICP" },
];

/** Keep overview scales local to the visible indicator and its current observations. */
export function overviewAxisTicks(data: OverviewChartPoint[], indicator: OverviewIndicator): number[] {
  const values = data.flatMap(point => OVERVIEW_REGIONS.flatMap(region => [point[region], point[`${region}Trend`]]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  if (indicator === "gdp") values.push(0);
  if (!values.length) return [];
  return getNiceTicks(values, 9, 0.05);
}
export function overviewRegionAxisTicks(data: OverviewChartPoint[], regions: OverviewRegion[]): number[] {
  const values = data.flatMap(point => regions.flatMap(region => [point[region], point[`${region}Trend`]]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  if (!values.length) return [];
  return getNiceTicks(values, 9, 0.05);
}
export function overviewAxisDomain(ticks: number[]): [number, number] {
  return getNiceTickDomain(ticks);
}

export function overviewAxisDigits(ticks: number[]): number {
  return getTickPrecision(ticks);
}

export const OVERVIEW_REGIONS: OverviewRegion[] = ["US", "UK", "EA"];
export const OVERVIEW_METRICS: Record<OverviewRegion, Record<OverviewIndicator, string>> = {
  US: { inflation: "us-cpi", gdp: "us-gdp-real", unemployment: "us-unemployment", wage: "us-ahe", retail: "us-retail-sales-total" },
  UK: { inflation: "uk-cpi-yoy", gdp: "uk-gdp-qoq", unemployment: "uk-unemployment", wage: "uk-awe-regular-yoy", retail: "uk-retail-sales-total-ex-fuel" },
  EA: { inflation: "ea-hicp-yoy", gdp: "ea-gdp-qoq", unemployment: "ea-unemployment", wage: "ea-wage-growth", retail: "ea-retail-sales-total-ex-motor-vehicles" },
};
const OVERVIEW_AUXILIARY_METRICS = [
  "us-cpi-mom", "uk-cpi-mom", "ea-hicp-mom",
  "us-ahe-mom", "uk-awe-regular-mom", "ea-wage-growth-qoq",
  "uk-retail-sales-total-yoy", "uk-retail-sales-total-3m3m",
];
const OVERVIEW_CORE_INFLATION_METRICS = [
  "us-cpi-core",
  "uk-core-cpi-yoy", "uk-core-cpi-mom",
  "ea-core-hicp-yoy", "ea-core-hicp-mom",
];
export function overviewMetricIds() {
  return [...new Set([
    ...OVERVIEW_REGIONS.flatMap(region => Object.values(OVERVIEW_METRICS[region])),
    ...OVERVIEW_AUXILIARY_METRICS, ...OVERVIEW_CORE_INFLATION_METRICS,
  ])];
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function overviewWindow(now = new Date(), payload?: OverviewPayload) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const current = year * 12 + month - 1;
  const published = payload
    ? overviewMetricIds().flatMap(id => payload[id]?.history ?? [])
      .flatMap(point => {
        const period = observationMonth(point.date);
        const index = period ? period.year * 12 + period.month - 1 : -1;
        return Number.isFinite(point.value) && index >= 0 && index <= current ? [index] : [];
      })
    : [];
  const end = published.length ? Math.max(...published) : current;
  const start = end - 12;
  const startYear = Math.floor(start / 12);
  const endYear = Math.floor(end / 12);
  const label = `${MONTH_NAMES[((start % 12) + 12) % 12]} ${startYear} – ${MONTH_NAMES[((end % 12) + 12) % 12]} ${endYear}`;
  return { monthCount: month, label };
}

function observationMonth(date: string, quarterlyStart = false): { year: number; month: number } | null {
  const quarter = date.match(/^(\d{4})[- ]Q([1-4])$/i);
  if (quarter) return { year: Number(quarter[1]), month: Number(quarter[2]) * 3 };
  const iso = date.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/);
  if (!iso || Number(iso[2]) < 1 || Number(iso[2]) > 12) return null;
  const year = Number(iso[1]);
  const month = Number(iso[2]);
  // Quarterly observations can be stored as quarter labels, quarter-start
  // dates, month-only dates, or dates within the quarter. Normalize every
  // known quarterly series to its quarter-end month so countries line up on
  // the same chart period.
  return { year, month: quarterlyStart ? Math.ceil(month / 3) * 3 : month };
}

function overviewReadings(payload: OverviewPayload, region: OverviewRegion, indicator: OverviewIndicator, now: Date) {
  const series = payload[OVERVIEW_METRICS[region][indicator]];
  const history = series?.history ?? [];
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const currentYear = Number(parts.find(part => part.type === "year")?.value);
  const currentMonth = Number(parts.find(part => part.type === "month")?.value);
  const currentPeriod = currentYear * 12 + currentMonth - 1;
  const lastCompletedQuarter = currentYear * 12 + Math.floor((currentMonth - 1) / 3) * 3 - 1;
  return history.flatMap(point => {
    // GDP overview histories are all quarterly, even when a provider labels
    // the period with a quarter-start month (or its frequency metadata uses
    // a different casing/wording). Normalize every observation to quarter end
    // before building the shared US/UK/EA chart timeline.
    const period = observationMonth(point.date, indicator === "gdp" || series?.meta?.frequency?.toLowerCase() === "quarterly");
    const periodIndex = period ? period.year * 12 + period.month - 1 : -1;
    if (!period || periodIndex > currentPeriod || indicator === "gdp" && periodIndex > lastCompletedQuarter || !Number.isFinite(point.value)) return [];
    const quarter = Math.ceil(period.month / 3);
    // BEA publishes US real GDP at an annualized rate. Convert only this
    // comparison view; retain the source observations and country page units.
    let value = indicator === "gdp" && region === "US"
      ? (Math.pow(1 + point.value / 100, 1 / 4) - 1) * 100
      : point.value;
    if (indicator === "inflation" && series?.meta?.unit === "index") {
      const previous = history.find(candidate => {
        const prior = observationMonth(candidate.date, series?.meta?.frequency === "quarterly");
        return prior?.year === period.year - 1 && prior.month === period.month;
      });
      if (!previous || !Number.isFinite(previous.value) || previous.value <= 0) return [];
      value = (point.value / previous.value - 1) * 100;
    }
    if (!Number.isFinite(value)) return [];
    return [{ date: point.date, value, month: period.month, year: period.year, periodIndex, quarter }];
  }).sort((a, b) => a.periodIndex - b.periodIndex || a.date.localeCompare(b.date));
}

export function latestOverviewReading(payload: OverviewPayload, region: OverviewRegion, indicator: OverviewIndicator, now = new Date()): OverviewObservation | null {
  const latest = overviewReadings(payload, region, indicator, now).at(-1);
  return latest ? { date: latest.date, value: latest.value } : null;
}

export type OverviewSummaryReading = {
  date: string;
  primary: number;
  secondary: number | null;
  primaryLabel: string;
  secondaryLabel: string;
  yearlyChange?: number | null;
  primaryChange: number | null;
  primaryChangeLabel: string;
  secondaryChange: number | null;
  secondaryChangeLabel: string;
};

const AUXILIARY_METRICS: Partial<Record<OverviewIndicator, Record<OverviewRegion, string>>> = {
  inflation: { US: "us-cpi-mom", UK: "uk-cpi-mom", EA: "ea-hicp-mom" },
  wage: { US: "us-ahe-mom", UK: "uk-awe-regular-mom", EA: "ea-wage-growth-qoq" },
};

function matchingAuxiliaryReadings(payload: OverviewPayload, metricId: string | undefined, periodIndex: number, now: Date) {
  if (!metricId) return { current: null, previous: null };
  const auxiliary = payload[metricId];
  const quarterly = auxiliary?.meta?.frequency === "quarterly";
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const latestAllowed = Number(nowParts.find(part => part.type === "year")?.value) * 12 + Number(nowParts.find(part => part.type === "month")?.value) - 1;
  const matches = (auxiliary?.history ?? []).flatMap(point => {
    const period = observationMonth(point.date, quarterly);
    const index = period ? period.year * 12 + period.month - 1 : -1;
    return period && index <= latestAllowed && Number.isFinite(point.value) ? [{ value: point.value, index }] : [];
  }).sort((a, b) => a.index - b.index);
  const current = matches.findLast(point => point.index === periodIndex) ?? null;
  const step = quarterly ? 3 : 1;
  const previous = current ? matches.findLast(point => point.index === periodIndex - step) ?? null : null;
  return { current: current?.value ?? null, previous: previous?.value ?? null };
}

const OVERVIEW_INFLATION_METRICS: Record<OverviewRegion, Record<"headline" | "core", { yoy: string; mom: string | null }>> = {
  US: {
    headline: { yoy: "us-cpi", mom: "us-cpi-mom" },
    core: { yoy: "us-cpi-core", mom: null },
  },
  UK: {
    headline: { yoy: "uk-cpi-yoy", mom: "uk-cpi-mom" },
    core: { yoy: "uk-core-cpi-yoy", mom: "uk-core-cpi-mom" },
  },
  EA: {
    headline: { yoy: "ea-hicp-yoy", mom: "ea-hicp-mom" },
    core: { yoy: "ea-core-hicp-yoy", mom: "ea-core-hicp-mom" },
  },
};

function inflationMetricReadings(payload: OverviewPayload, metricId: string, now: Date, rate: "yoy" | "mom") {
  const metric = payload[metricId];
  const history = metric?.history ?? [];
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const latestAllowed = Number(nowParts.find(part => part.type === "year")?.value) * 12 + Number(nowParts.find(part => part.type === "month")?.value) - 1;
  return history.flatMap(point => {
    const period = observationMonth(point.date);
    const periodIndex = period ? period.year * 12 + period.month - 1 : -1;
    if (!period || periodIndex > latestAllowed || !Number.isFinite(point.value)) return [];
    if (metric?.meta?.unit !== "index") return [{ date: point.date, periodIndex, value: point.value }];
    const priorIndex = periodIndex - (rate === "yoy" ? 12 : 1);
    const prior = history.find(candidate => {
      const priorPeriod = observationMonth(candidate.date);
      return priorPeriod != null && priorPeriod.year * 12 + priorPeriod.month - 1 === priorIndex;
    });
    if (!prior || !Number.isFinite(prior.value) || prior.value <= 0) return [];
    return [{ date: point.date, periodIndex, value: (point.value / prior.value - 1) * 100 }];
  }).sort((a, b) => a.periodIndex - b.periodIndex || a.date.localeCompare(b.date));
}

/** Return headline or core YoY/MoM readings and their prior-period movement cues. */
export function latestOverviewInflationMovement(
  payload: OverviewPayload,
  region: OverviewRegion,
  kind: "headline" | "core",
  now = new Date(),
): OverviewSummaryReading | null {
  const ids = OVERVIEW_INFLATION_METRICS[region][kind];
  const yoyReadings = inflationMetricReadings(payload, ids.yoy, now, "yoy");
  const latest = yoyReadings.at(-1);
  if (!latest) return null;
  const priorYoy = yoyReadings.findLast(reading => reading.periodIndex === latest.periodIndex - 1);
  const momMetric = ids.mom ? payload[ids.mom] : null;
  const momReadings = momMetric?.history.length
    ? inflationMetricReadings(payload, ids.mom!, now, "mom")
    : inflationMetricReadings(payload, ids.yoy, now, "mom");
  const currentMom = momReadings.findLast(reading => reading.periodIndex === latest.periodIndex);
  const priorMom = momReadings.findLast(reading => reading.periodIndex === latest.periodIndex - 1);
  return {
    date: latest.date,
    primary: latest.value,
    secondary: currentMom?.value ?? null,
    primaryLabel: "YoY",
    secondaryLabel: "MoM",
    primaryChange: priorYoy ? latest.value - priorYoy.value : null,
    primaryChangeLabel: "vs prior month",
    secondaryChange: currentMom && priorMom ? currentMom.value - priorMom.value : null,
    secondaryChangeLabel: "vs prior month",
  };
}

export function latestOverviewMovement(payload: OverviewPayload, indicator: OverviewIndicator, region: OverviewRegion, now = new Date()): OverviewSummaryReading | null {
  if (indicator === "inflation") return latestOverviewInflationMovement(payload, region, "headline", now);
  const readings = overviewReadings(payload, region, indicator, now);
  const latest = readings.at(-1);
  if (!latest) return null;
  const previousReading = readings.at(-2);
  const primaryChange = previousReading ? latest.value - previousReading.value : null;
  const primaryChangeLabel = indicator === "gdp" || indicator === "wage" && region === "EA" ? "vs prior quarter" : "vs prior month";
  if (indicator === "wage") {
    const auxiliary = matchingAuxiliaryReadings(payload, AUXILIARY_METRICS[indicator]?.[region], latest.periodIndex, now);
    return {
      date: latest.date,
      primary: latest.value,
      secondary: auxiliary.current,
      primaryLabel: "YoY",
      secondaryLabel: indicator === "wage" && region === "EA" ? "QoQ" : "MoM",
      primaryChange,
      primaryChangeLabel,
      secondaryChange: auxiliary.current != null && auxiliary.previous != null ? auxiliary.current - auxiliary.previous : null,
      secondaryChangeLabel: indicator === "wage" && region === "EA" ? "vs prior quarter" : "vs prior month",
    };
  }
  if (indicator === "retail") {
    const previous = readings.at(-2);
    return { date: latest.date, primary: latest.value, secondary: null, primaryLabel: "MoM", secondaryLabel: "", primaryChange: previous ? latest.value - previous.value : null, primaryChangeLabel: "vs prior month", secondaryChange: null, secondaryChangeLabel: "" };
  }
  if (indicator === "gdp") {
    const previous = [...readings].reverse().find(reading => reading.periodIndex === latest.periodIndex - 3);
    const previousPrevious = previous ? [...readings].reverse().find(reading => reading.periodIndex === previous.periodIndex - 3) : null;
    return { date: latest.date, primary: latest.value, secondary: previous?.value ?? null, primaryLabel: "QoQ", secondaryLabel: "Prior qtr", primaryChange: previous ? latest.value - previous.value : null, primaryChangeLabel: "vs prior quarter", secondaryChange: previous && previousPrevious ? previous.value - previousPrevious.value : null, secondaryChangeLabel: "vs prior quarter" };
  }
  const previousMonth = readings.find(reading => reading.periodIndex === latest.periodIndex - 1);
  const previousYear = readings.find(reading => reading.periodIndex === latest.periodIndex - 12);
  return {
    date: latest.date,
    primary: latest.value,
    secondary: previousMonth ? latest.value - previousMonth.value : null,
    primaryLabel: "Rate",
    secondaryLabel: "MoM Δ (pp)",
    yearlyChange: previousYear ? latest.value - previousYear.value : null,
    primaryChange: previousMonth ? latest.value - previousMonth.value : null,
    primaryChangeLabel: "vs prior month",
    secondaryChange: previousMonth && readings.find(reading => reading.periodIndex === latest.periodIndex - 2) ? (latest.value - previousMonth.value) - (previousMonth.value - readings.find(reading => reading.periodIndex === latest.periodIndex - 2)!.value) : null,
    secondaryChangeLabel: "vs prior month",
  };
}

export function overviewPeriodLabel(date: string, quarterly = false) {
  const period = observationMonth(date);
  return period ? quarterly ? `Q${Math.ceil(period.month / 3)} ${period.year}` : `${MONTH_NAMES[period.month - 1]} ${period.year}` : date;
}

export function buildOverviewSeries(payload: OverviewPayload, indicator: OverviewIndicator, now = new Date()): OverviewChartPoint[] {
  const readingsByRegion = Object.fromEntries(OVERVIEW_REGIONS.map(region => [region,
    indicator === "retail" ? retailYearOverYearReadings(payload, region, now) : overviewReadings(payload, region, indicator, now),
  ])) as Record<OverviewRegion, ReturnType<typeof overviewReadings>>;
  const trendsByRegion = Object.fromEntries(OVERVIEW_REGIONS.map(region => [region, indicator === "gdp" || indicator === "inflation" ? [] : overviewThreeMonthReadings(payload, region, indicator, readingsByRegion[region], now)])) as Record<OverviewRegion, ReturnType<typeof overviewReadings>>;
  const allReadings = OVERVIEW_REGIONS.flatMap(region => [...readingsByRegion[region], ...trendsByRegion[region]]);
  if (!allReadings.length) return [];
  const latest = Math.max(...allReadings.map(reading => reading.periodIndex));
  const cutoff = latest - 12;
  const firstPublished = Math.min(...allReadings.map(reading => reading.periodIndex));
  const first = indicator === "inflation" ? cutoff : indicator === "gdp" ? Math.min(firstPublished, latest - 12) : firstPublished;
  const step = indicator === "gdp" ? 3 : 1;
  const periods: number[] = [];
  if (indicator === "gdp") {
    // Anchor the sequence to quarter ends. Starting a `+3` loop at an
    // unnormalized month can otherwise produce labels for quarters that do
    // not correspond to the stored observation indexes.
    const firstQuarterEnd = Math.floor(first / 3) * 3 + 2;
    const latestQuarterEnd = Math.floor(latest / 3) * 3 + 2;
    for (let index = firstQuarterEnd; index <= latestQuarterEnd; index += 3) periods.push(index);
  } else {
    for (let index = first; index <= latest; index += step) periods.push(index);
  }
  const points: OverviewChartPoint[] = periods.map(index => {
    const year = Math.floor(index / 12);
    const month = index % 12 + 1;
    const quarter = Math.ceil(month / 3);
    return {
      date: indicator === "gdp" ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2, "0")}-01`,
      period: indicator === "gdp" ? `${year}-Q${quarter}` : `${year}-${String(month).padStart(2, "0")}`,
      label: indicator === "gdp" ? `Q${quarter} ${year}` : `${MONTH_NAMES[month - 1]} ’${String(year).slice(-2)}`,
      US: null, UK: null, EA: null, USTrend: null, UKTrend: null, EATrend: null,
    };
  });
  for (const region of OVERVIEW_REGIONS) {
    for (const reading of readingsByRegion[region]) {
      if (reading.periodIndex < first || reading.periodIndex > latest) continue;
      const point = points.find(item => item.period === (indicator === "gdp" ? `${reading.year}-Q${reading.quarter}` : `${reading.year}-${String(reading.month).padStart(2, "0")}`));
      if (point) point[region] = reading.value;
    }
    for (const reading of trendsByRegion[region]) {
      if (reading.periodIndex < first || reading.periodIndex > latest) continue;
      const point = points.find(item => item.period === `${reading.year}-${String(reading.month).padStart(2, "0")}`);
      if (point) point[`${region}Trend`] = reading.value;
    }
  }
  return points;
}

function indexedMonthlyHistory(payload: OverviewPayload, metricId: string, now: Date) {
  const metric = payload[metricId];
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const latestAllowed = Number(nowParts.find(part => part.type === "year")?.value) * 12 + Number(nowParts.find(part => part.type === "month")?.value) - 1;
  return (metric?.history ?? []).flatMap(point => {
    const period = observationMonth(point.date);
    const periodIndex = period ? period.year * 12 + period.month - 1 : -1;
    return period && periodIndex <= latestAllowed && Number.isFinite(point.value) ? [{ ...point, periodIndex }] : [];
  }).sort((a, b) => a.periodIndex - b.periodIndex);
}

function indexedQuarterlyHistory(payload: OverviewPayload, metricId: string, now: Date) {
  const metric = payload[metricId];
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const latestAllowed = Number(nowParts.find(part => part.type === "year")?.value) * 12 + Number(nowParts.find(part => part.type === "month")?.value) - 1;
  return (metric?.history ?? []).flatMap(point => {
    const period = observationMonth(point.date, true);
    const periodIndex = period ? period.year * 12 + period.month - 1 : -1;
    return period && periodIndex <= latestAllowed && Number.isFinite(point.value) ? [{ ...point, periodIndex }] : [];
  }).sort((a, b) => a.periodIndex - b.periodIndex);
}

function retailYearOverYearReadings(payload: OverviewPayload, region: OverviewRegion, now: Date) {
  if (region === "UK") {
    const published = indexedMonthlyHistory(payload, "uk-retail-sales-total-yoy", now);
    return published.map(point => {
      const period = observationMonth(point.date)!;
      return { date: point.date, value: point.value, month: period.month, year: period.year, periodIndex: point.periodIndex, quarter: Math.ceil(period.month / 3) };
    });
  }
  const metricId = OVERVIEW_METRICS[region].retail;
  const history = indexedMonthlyHistory(payload, metricId, now);
  const byPeriod = new Map(history.map(point => [point.periodIndex, point]));
  return history.flatMap(point => {
    const prior = byPeriod.get(point.periodIndex - 12);
    let value: number | null = null;
    if (point.rawValue != null && prior?.rawValue != null && point.rawValue > 0 && prior.rawValue > 0) {
      value = (point.rawValue / prior.rawValue - 1) * 100;
    } else {
      const monthlyWindow = Array.from({ length: 12 }, (_, lag) => byPeriod.get(point.periodIndex - 11 + lag)?.value);
      if (monthlyWindow.every((rate): rate is number => rate != null && Number.isFinite(rate))) {
        value = (monthlyWindow.reduce((product, rate) => product * (1 + rate / 100), 1) - 1) * 100;
      }
    }
    if (value == null || !Number.isFinite(value)) return [];
    const period = observationMonth(point.date)!;
    return [{ date: point.date, value, month: period.month, year: period.year, periodIndex: point.periodIndex, quarter: Math.ceil(period.month / 3) }];
  });
}

function trailingMonthlyAverage(readings: ReturnType<typeof overviewReadings>, periodIndex: number, count = 3) {
  const byPeriod = new Map(readings.map(reading => [reading.periodIndex, reading.value]));
  const window = Array.from({ length: count }, (_, lag) => byPeriod.get(periodIndex - count + 1 + lag));
  return window.every((value): value is number => value != null && Number.isFinite(value))
    ? window.reduce((sum, value) => sum + value, 0) / count
    : null;
}

function compoundedThreeMonthAnnualized(payload: OverviewPayload, metricId: string, now: Date) {
  const history = indexedMonthlyHistory(payload, metricId, now);
  const byPeriod = new Map(history.map(point => [point.periodIndex, point.value]));
  return history.flatMap(point => {
    const window = Array.from({ length: 3 }, (_, lag) => byPeriod.get(point.periodIndex - 2 + lag));
    if (!window.every((value): value is number => value != null && Number.isFinite(value))) return [];
    const value = (Math.pow(window.reduce((product, rate) => product * (1 + rate / 100), 1), 4) - 1) * 100;
    if (!Number.isFinite(value)) return [];
    const period = observationMonth(point.date)!;
    return [{ date: point.date, value, month: period.month, year: period.year, periodIndex: point.periodIndex, quarter: Math.ceil(period.month / 3) }];
  });
}

function compoundedThreeMonthAnnualizedIndex(payload: OverviewPayload, metricId: string, now: Date) {
  const history = indexedMonthlyHistory(payload, metricId, now);
  const byPeriod = new Map(history.map(point => [point.periodIndex, point]));
  return history.flatMap(point => {
    const indexWindow = [0, 1, 2, 3].map(lag => byPeriod.get(point.periodIndex - 3 + lag)?.rawValue);
    if (!indexWindow.every((value): value is number => value != null && Number.isFinite(value) && value > 0)) return [];
    const value = (Math.pow(indexWindow[3]! / indexWindow[0]!, 4) - 1) * 100;
    if (!Number.isFinite(value)) return [];
    const period = observationMonth(point.date)!;
    return [{ date: point.date, value, month: period.month, year: period.year, periodIndex: point.periodIndex, quarter: Math.ceil(period.month / 3) }];
  });
}

function overviewThreeMonthReadings(payload: OverviewPayload, region: OverviewRegion, indicator: OverviewIndicator, readings: ReturnType<typeof overviewReadings>, now: Date) {
  if (indicator === "unemployment") {
    return readings.flatMap(point => {
      const value = trailingMonthlyAverage(readings, point.periodIndex);
      return value == null ? [] : [{ ...point, value }];
    });
  }
  if (indicator === "retail" && region === "UK") {
    return indexedMonthlyHistory(payload, "uk-retail-sales-total-3m3m", now).map(point => {
      const period = observationMonth(point.date)!;
      return { date: point.date, value: point.value, month: period.month, year: period.year, periodIndex: point.periodIndex, quarter: Math.ceil(period.month / 3) };
    });
  }
  if (indicator === "retail" && region === "US") return compoundedThreeMonthAnnualized(payload, "us-retail-sales-total", now);
  if (indicator === "retail" && region === "EA") return compoundedThreeMonthAnnualizedIndex(payload, OVERVIEW_METRICS.EA.retail, now);
  if (indicator === "wage" && region === "US") return compoundedThreeMonthAnnualized(payload, "us-ahe-mom", now);
  if (indicator === "wage" && region === "UK") return compoundedThreeMonthAnnualized(payload, "uk-awe-regular-mom", now);
  if (indicator === "wage" && region === "EA") {
    return indexedQuarterlyHistory(payload, "ea-wage-growth-qoq", now).map(point => {
      const period = observationMonth(point.date, true)!;
      return { date: point.date, value: point.value, month: period.month, year: period.year, periodIndex: point.periodIndex, quarter: Math.ceil(period.month / 3) };
    });
  }
  return [];
}

const INFLATION_SERIES_IDS: Record<OverviewInflationMode, Record<string, string>> = {
  yoy: {
    usHeadline: "us-cpi", ukHeadline: "uk-cpi-yoy", eaHeadline: "ea-hicp-yoy",
    usCore: "us-cpi-core", ukCore: "uk-core-cpi-yoy", eaCore: "ea-core-hicp-yoy",
  },
  mom: {
    usHeadline: "us-cpi-mom", ukHeadline: "uk-cpi-mom", eaHeadline: "ea-hicp-mom",
    usCore: "us-cpi-core", ukCore: "uk-core-cpi-mom", eaCore: "ea-core-hicp-mom",
  },
};

/** Build the full monthly headline/core history so the shared year-range picker can reveal older observations. */
export function buildOverviewInflationSeries(payload: OverviewPayload, mode: OverviewInflationMode, now = new Date()): OverviewInflationPoint[] {
  const nowParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const latestAllowed = Number(nowParts.find(part => part.type === "year")?.value) * 12 + Number(nowParts.find(part => part.type === "month")?.value) - 1;
  const byKey = new Map<string, Map<number, number>>();
  const threeMonthByKey = new Map<string, Map<number, number>>();
  const allPeriods: number[] = [];
  for (const series of OVERVIEW_INFLATION_SERIES) {
    const metricId = INFLATION_SERIES_IDS[mode][series.key]!;
    const metric = payload[metricId];
    const indexedMetric = metric?.meta?.unit === "index";
    const values = new Map<number, number>();
    for (const point of metric?.history ?? []) {
      const period = observationMonth(point.date);
      const index = period ? period.year * 12 + period.month - 1 : -1;
      if (index < 0 || index > latestAllowed || !Number.isFinite(point.value)) continue;
      let value = point.value;
      if (indexedMetric) {
        const offset = mode === "yoy" ? 12 : 1;
        const previous = metric?.history.find(candidate => {
          const prior = observationMonth(candidate.date);
          return prior != null && prior.year * 12 + prior.month - 1 === index - offset;
        });
        if (!previous || !Number.isFinite(previous.value) || previous.value <= 0) continue;
        value = (point.value / previous.value - 1) * 100;
      }
      values.set(index, value);
      allPeriods.push(index);
    }
    byKey.set(series.key, values);

    // Match each source's available trend: US CPI uses the seasonally adjusted
    // index for 3m/3m SAAR; UK and Euro Area use a three-observation mean of
    // their published YoY rates (HICP is not seasonally adjusted).
    if (mode === "yoy") {
      const trendMetricId = INFLATION_SERIES_IDS.yoy[series.key]!;
      const trendMetric = payload[trendMetricId];
      const observations = new Map<number, number>();
      for (const point of trendMetric?.history ?? []) {
        const period = observationMonth(point.date);
        const index = period ? period.year * 12 + period.month - 1 : -1;
        if (index >= 0 && index <= latestAllowed && Number.isFinite(point.value)) observations.set(index, point.value);
      }
      const trendValues = new Map<number, number>();
      for (const index of values.keys()) {
        if (series.region === "US" && trendMetric?.meta?.unit === "index") {
          const window = [0, 1, 2, 3].map(lag => observations.get(index - 3 + lag));
          if (window.every((value): value is number => value != null && Number.isFinite(value)) && window[0]! > 0) {
            const rate = (Math.pow(window[3]! / window[0]!, 4) - 1) * 100;
            if (Number.isFinite(rate)) trendValues.set(index, rate);
          }
        } else if (series.region === "UK") {
          const window = [observations.get(index - 2), observations.get(index - 1), observations.get(index)];
          if (window.every((value): value is number => value != null && Number.isFinite(value))) {
            trendValues.set(index, window.reduce((sum, value) => sum + value, 0) / 3);
          }
        } else if (series.region === "EA") {
          const window = [observations.get(index - 2), observations.get(index - 1), observations.get(index)];
          if (window.every((value): value is number => value != null && Number.isFinite(value))) {
            trendValues.set(index, window.reduce((sum, value) => sum + value, 0) / 3);
          }
        }
      }
      threeMonthByKey.set(series.key, trendValues);
    }
  }
  if (!allPeriods.length) return [];
  const first = Math.min(...allPeriods);
  const last = Math.max(...allPeriods);
  const points: OverviewInflationPoint[] = [];
  for (let index = first; index <= last; index += 1) {
    const year = Math.floor(index / 12);
    const month = index % 12 + 1;
    const point: OverviewInflationPoint = {
      date: `${year}-${String(month).padStart(2, "0")}-01`,
      period: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MONTH_NAMES[month - 1]} ’${String(year).slice(-2)}`,
    };
    for (const series of OVERVIEW_INFLATION_SERIES) {
      point[series.key] = byKey.get(series.key)?.get(index) ?? null;
      point[`${series.key}3m3m`] = threeMonthByKey.get(series.key)?.get(index) ?? null;
    }
    points.push(point);
  }
  return points;
}
