import { getOfficialComponentWeight } from "./official-component-weights";

export type ContributionMetric = { meta: { unit?: string; transform?: string }; history: Array<{ date: string; value: number }> };
export type ContributionMetrics = Record<string, ContributionMetric | undefined>;
export type ContributionMode = "yoy" | "mom";
type Component = { id: string; label: string; momId?: string; children?: Component[] };
export type ContributionConfig = { title: string; headline: string; core?: string; headlineYoy?: string; headlineMom?: string; coreYoy?: string; coreMom?: string; components: Component[]; coreComponents?: Component[] };
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
  const denominator = core ? components.reduce((sum, item) => sum + (getOfficialComponentWeight(item.id)?.value ?? 0), 0) : 100;
  const priorPeriod = previousContributionMonth(period);
  const buildRow = (item: Component, parent: string | null = null) => {
    const weight = getOfficialComponentWeight(item.id);
    const share = weight && denominator > 0 ? weight.value / denominator * 100 : null;
    const rateAt = (month: string) => (mode === "mom" ? contributionRate(metrics[item.momId ?? ""], month, mode, "mom") : null)
      ?? contributionRate(metrics[item.id], month, mode, "yoy");
    const currentRate = rateAt(period);
    const priorRate = rateAt(priorPeriod);
    const current = weight?.year === Number(period.slice(0, 4)) && period >= weight.validFrom && share != null && currentRate != null ? share * currentRate / 100 : null;
    const previous = weight?.year === Number(priorPeriod.slice(0, 4)) && priorPeriod >= weight.validFrom && share != null && priorRate != null ? share * priorRate / 100 : null;
    return { ...item, parent, subtotal: Boolean(item.children?.length), countInTotal: parent === null, weight, share, currentRate, current, previous, change: current != null && previous != null ? current - previous : null };
  };
  const rows = components.map(item => buildRow(item)).sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))
    .flatMap(row => [row, ...(row.children ?? []).map(child => buildRow(child, row.label)).sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity))]);
  const rootId = core ? config.core! : config.headline;
  const rateId = mode === "mom" ? core ? config.coreMom : config.headlineMom : core ? config.coreYoy : config.headlineYoy;
  const published = contributionRate(metrics[rateId ?? ""], period, mode, mode)
    ?? contributionRate(metrics[rootId], period, mode, "yoy");
  const topRows = rows.filter(row => row.countInTotal);
  const covered = topRows.filter(row => row.current != null);
  const estimated = covered.reduce((sum, row) => sum + row.current!, 0);
  return { rows, published, estimated, residual: published != null && covered.length === topRows.length ? published - estimated : null, coverage: covered.reduce((sum, row) => sum + (row.share ?? 0), 0), priorPeriod };
}
