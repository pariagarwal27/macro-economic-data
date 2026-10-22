import type { OverviewPayload, OverviewRegion } from "./overview-data";

export type ExpectationsOverviewCategory = "consumer" | "business" | "market" | "wage";
export type ExpectationsOverviewHorizon = "1y" | "5y" | "5y5y";

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
  horizon: ExpectationsOverviewHorizon | null;
  label: string;
  measure: string;
  note: string;
  metricIds: Record<OverviewRegion, string>;
  metricLabels: Record<OverviewRegion, string>;
};

export const EXPECTATIONS_OVERVIEW_CATEGORIES: CategoryDefinition[] = [
  {
    id: "consumer",
    horizon: "1y",
    label: "Consumer",
    measure: "Consumer inflation expectations · 1Y ahead",
    note: "Household inflation surveys · 1-year-ahead median",
    metricIds: { US: "us-nyfed-sce-1y", UK: "uk-inflation-exp-1y", EA: "ea-ces-inflation-exp-1y" },
    metricLabels: { US: "NY Fed SCE 1Y", UK: "BoE 1Y", EA: "ECB CES 1Y" },
  },
  {
    id: "business",
    horizon: "1y",
    label: "Business",
    measure: "Business inflation expectations · 1Y ahead",
    note: "Business price expectations over the next year: unit costs in the US, CPI inflation in the UK and selling prices in the Euro Area; definitions vary by survey",
    metricIds: { US: "us-atlanta-bie-1y", UK: "uk-dmp-inflation-exp-1y", EA: "ea-safe-selling-price-exp-1y" },
    metricLabels: { US: "Atlanta Fed BIE 1Y", UK: "BoE DMP 1Y", EA: "ECB SAFE selling prices · 1Y" },
  },
  {
    id: "market",
    horizon: "5y",
    label: "Market-based",
    measure: "Market-based inflation compensation · 5Y",
    note: "5-year market-implied inflation compensation; includes inflation risk and liquidity premia",
    metricIds: { US: "us-breakeven-5y", UK: "uk-inflation-comp-5y", EA: "ea-inflation-comp-5y" },
    metricLabels: { US: "US 5Y breakeven", UK: "UK 5Y compensation", EA: "Euro Area 5Y compensation" },
  },
  {
    id: "wage",
    horizon: null,
    label: "Wage tracker",
    measure: "Published wage growth and wage expectations",
    note: "US: Atlanta Fed observed median annual wage growth (3-month overall series). UK: BoE DMP expected wage growth over the next year (3-month average). Euro Area: ECB negotiated wage tracker including smoothed one-off payments",
    metricIds: { US: "us-atlanta-wage", UK: "uk-dmp-wage-exp-1y", EA: "ea-wage-tracker" },
    metricLabels: { US: "Atlanta Fed Wage Growth Tracker", UK: "BoE DMP expected wage growth · 1Y", EA: "ECB Wage Tracker" },
  },
];

const FIVE_YEAR_CATEGORIES: Partial<Record<ExpectationsOverviewCategory, CategoryDefinition>> = {
  consumer: {
    id: "consumer",
    horizon: "5y",
    label: "Consumer",
    measure: "Consumer inflation expectations · 5Y ahead",
    note: "Household inflation surveys · published 5-year expectations",
    metricIds: { US: "us-nyfed-sce-5y", UK: "uk-inflation-exp-5y", EA: "ea-ces-inflation-exp-5y" },
    metricLabels: { US: "NY Fed SCE 5Y", UK: "BoE 5Y", EA: "ECB CES 5Y" },
  },
};

const FIVE_YEAR_FIVE_YEAR_CATEGORIES: Partial<Record<ExpectationsOverviewCategory, CategoryDefinition>> = {
  market: {
    id: "market",
    horizon: "5y5y",
    label: "Market-based",
    measure: "Market-based inflation compensation · 5Y5Y",
    note: "United States and United Kingdom show 5Y5Y forward compensation; Euro Area remains on its published 5Y measure",
    metricIds: { US: "us-5y5y-forward", UK: "uk-inflation-comp-5y5y", EA: "ea-inflation-comp-5y" },
    metricLabels: { US: "US 5Y5Y forward", UK: "UK 5Y5Y forward", EA: "Euro Area 5Y compensation" },
  },
};

export function expectationsOverviewMetricIds(): string[] {
  return [...new Set([...EXPECTATIONS_OVERVIEW_CATEGORIES, ...Object.values(FIVE_YEAR_CATEGORIES), ...Object.values(FIVE_YEAR_FIVE_YEAR_CATEGORIES)]
    .flatMap(category => Object.values(category.metricIds)))];
}

export function expectationsOverviewHorizons(id: ExpectationsOverviewCategory): ExpectationsOverviewHorizon[] {
  if (FIVE_YEAR_FIVE_YEAR_CATEGORIES[id]) return ["5y", "5y5y"];
  if (FIVE_YEAR_CATEGORIES[id]) return ["1y", "5y"];
  const horizon = expectationsOverviewCategory(id).horizon;
  return horizon ? [horizon] : [];
}

export function expectationsOverviewCategory(id: ExpectationsOverviewCategory, horizon: ExpectationsOverviewHorizon = "1y"): CategoryDefinition {
  if (horizon === "5y5y" && FIVE_YEAR_FIVE_YEAR_CATEGORIES[id]) return FIVE_YEAR_FIVE_YEAR_CATEGORIES[id]!;
  if (horizon === "5y" && FIVE_YEAR_CATEGORIES[id]) return FIVE_YEAR_CATEGORIES[id]!;
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
  horizon: ExpectationsOverviewHorizon = "1y",
): ExpectationsOverviewPoint[] {
  const category = expectationsOverviewCategory(categoryId, horizon);
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
