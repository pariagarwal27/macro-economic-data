import { getOfficialComponentWeight } from "./official-component-weights";

export type ContributionMetric = { meta: { unit?: string; transform?: string }; history: Array<{ date: string; value: number }>; weightHistory?: Array<{ date: string; value: number }> };
export type ContributionMetrics = Record<string, ContributionMetric | undefined>;
export type ContributionMode = "yoy" | "mom";
type Component = { id: string; label: string; momId?: string; children?: Component[] };
export type ContributionConfig = { title: string; headline: string; core?: string; headlineName?: string; coreName?: string; displayRatesOnly?: boolean; note?: string; noteSource?: { label: string; url: string }; headlineYoy?: string; headlineMom?: string; coreYoy?: string; coreMom?: string; components: Component[]; coreComponents?: Component[] };
const usCore: Component[] = [
  { id: "us-core-goods-cpi-yoy", label: "Core goods", momId: "us-core-goods-cpi-mom", children: [
    { id: "us-cpi-apparel", label: "Apparel" },
    { id: "us-cpi-new-vehicles", label: "New vehicles" },
    { id: "us-cpi-used-cars", label: "Used cars & trucks" },
    { id: "us-cpi-medical-commodities", label: "Medical care commodities" },
    { id: "us-cpi-recreation-commodities", label: "Recreation commodities" },
    { id: "us-cpi-education-commodities", label: "Education & communication commodities" },
    { id: "us-cpi-other-goods", label: "Other goods" },
  ] },
  { id: "us-services-cpi-yoy", label: "Core services", momId: "us-services-cpi-mom", children: [
    { id: "us-cpi-shelter", label: "Shelter" },
    { id: "us-cpi-medical-services", label: "Medical care services" },
    { id: "us-cpi-transport-services", label: "Transportation services" },
    { id: "us-cpi-recreation-services", label: "Recreation services" },
    { id: "us-cpi-education-services", label: "Education & communication services" },
    { id: "us-cpi-other-services", label: "Other services" },
  ] },
];
const ukDivisions = ["food", "alcohol", "clothing", "housing", "furniture", "health", "transport", "communication", "recreation", "education", "restaurants-hotels", "miscellaneous"];
const ukLabels = ["Food & non-alcoholic beverages", "Alcohol & tobacco", "Clothing & footwear", "Housing & household services", "Furniture & household goods", "Health", "Transport", "Communication", "Recreation & culture", "Education", "Restaurants & hotels", "Miscellaneous goods & services"];
const ukComponents = (basket: string) => ukDivisions.map((division, index) => ({ id: `uk-${division}-${basket}-yoy`, label: ukLabels[index], momId: `uk-${division}-${basket}-mom` }));
const eaCore: Component[] = [{ id: "ea-goods-hicp-yoy", label: "Non-energy industrial goods", momId: "ea-goods-hicp-mom" }, { id: "ea-services-hicp-yoy", label: "Services", momId: "ea-services-hicp-mom" }];
const us: ContributionConfig = { title: "CPI", headline: "us-cpi", core: "us-cpi-core", headlineYoy: "us-cpi-yoy", headlineMom: "us-cpi-mom", coreYoy: "us-core-cpi-yoy", coreMom: "us-core-cpi-mom", components: [{ id: "us-cpi-food", label: "Food" }, { id: "us-cpi-energy", label: "Energy" }, ...usCore], coreComponents: usCore };
const ea: ContributionConfig = { title: "HICP", headline: "ea-hicp-yoy", core: "ea-core-hicp-yoy", headlineMom: "ea-hicp-mom", coreMom: "ea-core-hicp-mom", components: [{ id: "ea-food-hicp-yoy", label: "Food, alcohol & tobacco", momId: "ea-food-hicp-mom" }, { id: "ea-energy-hicp-yoy", label: "Energy", momId: "ea-energy-hicp-mom" }, ...eaCore], coreComponents: eaCore };
export const CONTRIBUTION_CONFIGS: Record<string, ContributionConfig> = {
  "us-cpi": us, "us-cpi-core": us,
  "uk-cpi-yoy": { title: "CPI", headline: "uk-cpi-yoy", headlineMom: "uk-cpi-mom", components: ukComponents("cpi") },
  "uk-cpih-yoy": { title: "CPIH", headline: "uk-cpih-yoy", headlineMom: "uk-cpih-mom", components: ukComponents("cpih") },
  "uk-core-cpi-yoy": {
    title: "Core inflation", headline: "uk-core-cpi-yoy", core: "uk-core-cpih-yoy",
    headlineName: "Core CPI", coreName: "Core CPIH", displayRatesOnly: true,
    headlineMom: "uk-core-cpi-mom",
    components: ["clothing", "furniture", "health", "communication", "recreation", "education", "restaurants-hotels", "miscellaneous"].map((division) => ({
      id: `uk-${division}-cpi-yoy`, momId: `uk-${division}-cpi-mom`,
      label: ukLabels[ukDivisions.indexOf(division)],
    })),
    coreComponents: ["clothing", "furniture", "health", "communication", "recreation", "education", "restaurants-hotels", "miscellaneous"].map((division) => ({
      id: `uk-${division}-cpih-yoy`, momId: `uk-${division}-cpih-mom`,
      label: ukLabels[ukDivisions.indexOf(division)],
    })),
    note: "ONS core excludes energy, food, alcohol and tobacco. This table shows CPI/CPIH divisions fully within that definition; housing and transport are omitted because their published division rates also include excluded direct energy items. Weights are published shares of the full basket, and rates are not additive contributions. Core CPIH MoM is not mapped, so that KPI remains blank rather than substituting YoY.",
    noteSource: { label: "ONS explanation of energy exclusions", url: "https://www.ons.gov.uk/aboutus/transparencyandgovernance/freedomofinformationfoi/energycostsandthecomputationofcoreinflation" },
  },
  "ea-hicp-yoy": ea, "ea-core-hicp-yoy": ea,
};
export function contributionMetricIds() {
  const idsFor = (item: Component): Array<string | undefined> => [item.id, item.momId, ...(item.children ?? []).flatMap(idsFor)];
  return [...new Set(Object.values(CONTRIBUTION_CONFIGS).flatMap(config => [
    config.headline, config.core, config.headlineYoy, config.headlineMom, config.coreYoy, config.coreMom,
    ...[...config.components, ...(config.coreComponents ?? [])].flatMap(idsFor),
  ]).filter((id): id is string => Boolean(id)))];
}
export const previousContributionMonth = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
};
function pointAt(metric: ContributionMetric | undefined, period: string) {
  return metric?.history.filter(point => point.date.slice(0, 7) === period && Number.isFinite(point.value)).at(-1)?.value ?? null;
}
export function contributionRate(metric: ContributionMetric | undefined, period: string, mode: ContributionMode, publishedMode?: ContributionMode): number | null {
  const value = pointAt(metric, period);
  if (value == null || !metric) return null;
  if (metric.meta.unit === "index") {
    const previous = mode === "mom" ? previousContributionMonth(period) : `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
    const base = pointAt(metric, previous);
    return base != null && base > 0 ? (value / base - 1) * 100 : null;
  }
  const transform = metric.meta.transform ?? "";
  if (publishedMode) return publishedMode === mode ? value : null;
  if (mode === "mom" && !transform.includes("mom")) return null;
  if (mode === "yoy" && transform.includes("mom")) return null;
  return value;
}
export function buildInflationContributions(config: ContributionConfig, metrics: ContributionMetrics, period: string, core: boolean, mode: ContributionMode) {
  const components = core ? config.coreComponents ?? [] : config.components;
  const priorPeriod = previousContributionMonth(period);
  const basePeriod = (month: string) => mode === "mom" ? previousContributionMonth(month) : `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  const weightAt = (id: string, comparisonPeriod: string, displayedPeriod: string) => {
    const observed = metrics[id]?.weightHistory?.find(point => point.date === comparisonPeriod)?.value;
    if (observed != null && Number.isFinite(observed)) return {
      value: observed, year: Number(comparisonPeriod.slice(0, 4)), validFrom: comparisonPeriod,
      basis: `BLS CPI-U monthly relative importance for ${comparisonPeriod}; comparison-base-period weight`,
      source: "https://www.bls.gov/cpi/factsheets/using-cpi-metadata-aspect-files.htm",
    };
    // Preserve the published annual-reference fallback for recent periods if
    // the official monthly aspect feed is temporarily unavailable.
    return getOfficialComponentWeight(id, displayedPeriod);
  };
  const denominatorAt = (month: string) => core && !config.displayRatesOnly ? components.reduce((sum, item) => sum + (weightAt(item.id, basePeriod(month), month)?.value ?? 0), 0) : 100;
  const denominator = denominatorAt(period);
  const priorDenominator = denominatorAt(priorPeriod);
  const buildRow = (item: Component, parent: string | null = null) => {
    const weight = weightAt(item.id, basePeriod(period), period);
    const priorWeight = weightAt(item.id, basePeriod(priorPeriod), priorPeriod);
    const share = weight && denominator > 0 ? config.displayRatesOnly ? weight.value : weight.value / denominator * 100 : null;
    const rateAt = (month: string) => mode === "mom"
      ? item.momId ? contributionRate(metrics[item.momId], month, mode, "mom") : contributionRate(metrics[item.id], month, mode)
      : contributionRate(metrics[item.id], month, mode, "yoy");
    const currentRate = rateAt(period);
    const priorRate = rateAt(priorPeriod);
    const current = !config.displayRatesOnly && weight != null && share != null && currentRate != null ? share * currentRate / 100 : null;
    const priorShare = priorWeight && priorDenominator > 0 ? priorWeight.value / priorDenominator * 100 : null;
    const previous = !config.displayRatesOnly && priorShare != null && priorRate != null ? priorShare * priorRate / 100 : null;
    return { ...item, parent, subtotal: Boolean(item.children?.length), countInTotal: parent === null, weight, share, currentRate, current, previous, change: current != null && previous != null ? current - previous : null };
  };
  // Sort each level by its official basket weight, keeping subdivisions grouped
  // immediately beneath their parent. Missing weights sort after known weights.
  const byWeightDescending = <T extends { weight: { value: number } | null }>(a: T, b: T) =>
    (b.weight?.value ?? -Infinity) - (a.weight?.value ?? -Infinity);
  const rows = components.map(item => buildRow(item))
    .sort(byWeightDescending)
    .flatMap(row => [row, ...(row.children ?? []).map(child => buildRow(child, row.label)).sort(byWeightDescending)]);
  const rootId = core ? config.core! : config.headline;
  const rateId = mode === "mom" ? core ? config.coreMom : config.headlineMom : core ? config.coreYoy : config.headlineYoy;
  const published = contributionRate(metrics[rateId ?? ""], period, mode, mode)
    ?? contributionRate(metrics[rootId], period, mode, "yoy");
  const topRows = rows.filter(row => row.countInTotal);
  const covered = topRows.filter(row => row.current != null);
  const estimated = covered.reduce((sum, row) => sum + row.current!, 0);
  return { rows, published, estimated, residual: published != null && covered.length === topRows.length ? published - estimated : null, coverage: covered.reduce((sum, row) => sum + (row.share ?? 0), 0), priorPeriod };
}
