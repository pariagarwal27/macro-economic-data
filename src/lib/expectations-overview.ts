import type { OverviewPayload, OverviewRegion } from "./overview-data";

export type ExpectationsOverviewCategory = "consumer" | "business" | "professional" | "market";

export type ExpectationsOverviewPoint = {
  date: string;
  period: string;
  label: string;
  US: number | null;
  UK: number | null;
  EA: number | null;
};

type CategoryDefinition = {
  id: ExpectationsOverviewCategory;
  label: string;
  measure: string;
  note: string;
  metricIds: Record<OverviewRegion, string>;
  metricLabels: Record<OverviewRegion, string>;
};

export const EXPECTATIONS_OVERVIEW_CATEGORIES: CategoryDefinition[] = [
  {
    id: "consumer",
    label: "Consumer",
    measure: "Consumer inflation expectations · 1Y ahead",
    note: "Household inflation surveys · 1-year-ahead median",
    metricIds: { US: "us-nyfed-sce-1y", UK: "uk-inflation-exp-1y", EA: "ea-ces-inflation-exp-1y" },
    metricLabels: { US: "NY Fed SCE 1Y", UK: "BoE 1Y", EA: "ECB CES 1Y" },
  },
  {
    id: "business",
    label: "Business",
    measure: "Business inflation expectations · 1Y ahead",
    note: "Business surveys · expected price inflation over the next year",
    metricIds: { US: "us-atlanta-bie-1y", UK: "uk-dmp-inflation-exp-1y", EA: "ea-safe-inflation-exp-1y" },
    metricLabels: { US: "Atlanta Fed BIE 1Y", UK: "BoE DMP 1Y", EA: "ECB SAFE 1Y" },
  },
  {
    id: "professional",
    label: "Professional forecasts",
    measure: "Professional inflation forecasts · 1Y ahead",
    note: "Professional forecasters · headline consumer inflation, 1-year horizon",
    metricIds: { US: "us-philly-spf-cpi-1y", UK: "uk-maps-inflation-1y", EA: "ea-spf-hicp-1y" },
    metricLabels: { US: "Philadelphia Fed SPF CPI 1Y", UK: "BoE MaPS CPI 1Y", EA: "ECB SPF HICP 1Y" },
  },
  {
    id: "market",
    label: "Market-based",
    measure: "Market-based inflation compensation · 5Y",
    note: "5-year market-implied inflation compensation; includes inflation risk and liquidity premia",
    metricIds: { US: "us-breakeven-5y", UK: "uk-inflation-comp-5y", EA: "ea-inflation-comp-5y" },
    metricLabels: { US: "US 5Y breakeven", UK: "UK 5Y compensation", EA: "Euro Area 5Y compensation" },
  },
];

export function expectationsOverviewMetricIds(): string[] {
  return EXPECTATIONS_OVERVIEW_CATEGORIES.flatMap(category => Object.values(category.metricIds));
}

export function expectationsOverviewCategory(id: ExpectationsOverviewCategory): CategoryDefinition {
  return EXPECTATIONS_OVERVIEW_CATEGORIES.find(category => category.id === id) ?? EXPECTATIONS_OVERVIEW_CATEGORIES[0]!;
}

function periodMonth(date: string): { year: number; month: number } | null {
  const quarter = date.match(/^(\d{4})[- ]Q([1-4])$/i);
  if (quarter) return { year: Number(quarter[1]), month: Number(quarter[2]) * 3 };
  const match = date.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
}

function monthLabel(month: number): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]!;
}

export function buildExpectationsOverviewSeries(
  payload: OverviewPayload,
  categoryId: ExpectationsOverviewCategory,
  now = new Date(),
): ExpectationsOverviewPoint[] {
  const category = expectationsOverviewCategory(categoryId);
  const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "numeric" }).formatToParts(now);
  const currentYear = Number(calendar.find(part => part.type === "year")?.value);
  const latestMonth = Number(calendar.find(part => part.type === "month")?.value);
  const currentPeriod = currentYear * 12 + latestMonth - 1;
  const points = new Map<string, ExpectationsOverviewPoint>();

  for (const region of ["US", "UK", "EA"] as const) {
    const history = payload[category.metricIds[region]]?.history ?? [];
    // Sorting lets daily market observations collapse deterministically to each month's latest value.
    for (const observation of [...history].sort((left, right) => left.date.localeCompare(right.date))) {
      if (!Number.isFinite(observation.value)) continue;
      const parsed = periodMonth(observation.date);
      const periodIndex = parsed ? parsed.year * 12 + parsed.month - 1 : -1;
      if (!parsed || periodIndex > currentPeriod) continue;
      const period = `${parsed.year}-${String(parsed.month).padStart(2, "0")}`;
      const point = points.get(period) ?? { date: `${period}-01`, period, label: `${monthLabel(parsed.month)} ’${String(parsed.year).slice(-2)}`, US: null, UK: null, EA: null };
      point[region] = observation.value;
      points.set(period, point);
    }
  }

  return [...points.values()].sort((left, right) => left.period.localeCompare(right.period));
}
