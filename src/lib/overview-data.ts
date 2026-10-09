export type OverviewRegion = "US" | "UK" | "EA";
export type OverviewIndicator = "inflation" | "gdp" | "unemployment";
export type OverviewObservation = { date: string; value: number };
export type OverviewPayload = Record<string, {
  history: OverviewObservation[];
  meta?: { liveSource?: string | null; name?: string; unit?: string };
} | null>;
export type OverviewChartPoint = { period: string; label: string; US: number | null; UK: number | null; EA: number | null };

export const OVERVIEW_REGIONS: OverviewRegion[] = ["US", "UK", "EA"];
export const OVERVIEW_METRICS: Record<OverviewRegion, Record<OverviewIndicator, string>> = {
  US: { inflation: "us-cpi", gdp: "us-gdp-real", unemployment: "us-unemployment" },
  UK: { inflation: "uk-cpi-yoy", gdp: "uk-gdp-qoq", unemployment: "uk-unemployment" },
  EA: { inflation: "ea-hicp-yoy", gdp: "ea-gdp-qoq", unemployment: "ea-unemployment" },
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function overviewWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const monthCount = year < 2026 ? 0 : year > 2026 ? 12 : month;
  return { monthCount, label: monthCount ? `Jan – ${MONTH_NAMES[monthCount - 1]} 2026` : "2026 · no observations yet" };
}

function observationMonth(date: string): { year: number; month: number } | null {
  const quarter = date.match(/^(\d{4})[- ]Q([1-4])$/i);
  if (quarter) return { year: Number(quarter[1]), month: (Number(quarter[2]) - 1) * 3 + 1 };
  const iso = date.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/);
  if (!iso || Number(iso[2]) < 1 || Number(iso[2]) > 12) return null;
  return { year: Number(iso[1]), month: Number(iso[2]) };
}

function overviewReadings(payload: OverviewPayload, region: OverviewRegion, indicator: OverviewIndicator, now: Date) {
  const window = overviewWindow(now);
  const series = payload[OVERVIEW_METRICS[region][indicator]];
  const history = series?.history ?? [];
  return history.flatMap(point => {
    const period = observationMonth(point.date);
    if (!period || period.year !== 2026 || period.month > window.monthCount || !Number.isFinite(point.value)) return [];
    const quarter = Math.ceil(period.month / 3);
    if (indicator === "gdp" && quarter > Math.floor(window.monthCount / 3)) return [];
    // BEA publishes US real GDP at an annualized rate. Convert only this
    // comparison view; retain the source observations and country page units.
    let value = indicator === "gdp" && region === "US"
      ? (Math.pow(1 + point.value / 100, 1 / 4) - 1) * 100
      : point.value;
    if (indicator === "inflation" && series?.meta?.unit === "index") {
      const previous = history.find(candidate => {
        const prior = observationMonth(candidate.date);
        return prior?.year === period.year - 1 && prior.month === period.month;
      });
      if (!previous || !Number.isFinite(previous.value) || previous.value <= 0) return [];
      value = (point.value / previous.value - 1) * 100;
    }
    if (!Number.isFinite(value)) return [];
    return [{ date: point.date, value, month: period.month, quarter }];
  }).sort((a, b) => a.month - b.month || a.date.localeCompare(b.date));
}

export function latestOverviewReading(payload: OverviewPayload, region: OverviewRegion, indicator: OverviewIndicator, now = new Date()): OverviewObservation | null {
  const latest = overviewReadings(payload, region, indicator, now).at(-1);
  return latest ? { date: latest.date, value: latest.value } : null;
}

export function overviewPeriodLabel(date: string, quarterly = false) {
  const period = observationMonth(date);
  return period ? quarterly ? `Q${Math.ceil(period.month / 3)} ${period.year}` : `${MONTH_NAMES[period.month - 1]} ${period.year}` : date;
}

export function buildOverviewSeries(payload: OverviewPayload, indicator: OverviewIndicator, now = new Date()): OverviewChartPoint[] {
  const count = indicator === "gdp" ? Math.floor(overviewWindow(now).monthCount / 3) : overviewWindow(now).monthCount;
  const points: OverviewChartPoint[] = Array.from({ length: count }, (_, index) => ({
    period: indicator === "gdp" ? `2026-Q${index + 1}` : `2026-${String(index + 1).padStart(2, "0")}`,
    label: indicator === "gdp" ? `Q${index + 1} 2026` : `${MONTH_NAMES[index]} ’26`,
    US: null, UK: null, EA: null,
  }));
  for (const region of OVERVIEW_REGIONS) {
    for (const reading of overviewReadings(payload, region, indicator, now)) {
      const index = (indicator === "gdp" ? reading.quarter : reading.month) - 1;
      if (points[index]) points[index][region] = reading.value;
    }
  }
  return points;
}
