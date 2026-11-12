import { buildInflationContributions, contributionRate, previousContributionMonth, type ContributionConfig, type ContributionMetrics, type ContributionMode } from "./inflation-contributions";
import { calendarWindow, classifyCpiDriver, disjointNodes, type ReleaseDriverRow } from "./release-driver-model";
import { getOfficialRetailIndexWeight } from "./official-retail-weights";
import { retailDriverRate } from "./retail-driver-readings";
import { PCE_COMPONENT_EXPENDITURE } from "./pce-expenditure";

export type ReleaseMetric = { meta: { unit?: string; transform?: string; frequency?: string }; history: Array<{ date: string; value: number; rawValue?: number | null }> };
export type ReleaseMetrics = Record<string, ReleaseMetric | undefined>;
export type ReleaseNode = { id: string; label: string; metricId?: string; children?: ReleaseNode[] };
export function retailBasketComponents<T extends ReleaseNode>(nodes: T[], region: "US" | "UK" | "EA", seriesId: string): T[] {
  const prefix = region.toLowerCase();
  const excluded = new Set([
    "us-retail-sales-total", "us-retail-sales-control-group", "us-retail-total-ex-auto-gas",
    "uk-retail-sales-total-ex-fuel", "uk-retail-sales-ex-fuel",
    "ea-retail-sales-total-ex-motor-vehicles", "ea-retail-sales-ex-fuel",
  ]);
  if (region === "US" && seriesId === "us-retail-sales-control-group") ["us-retail-motor-vehicles", "us-retail-gasoline", "us-retail-food-services"].forEach(id => excluded.add(id));
  // The legacy UK headline ID itself ends in "total-ex-fuel", despite being
  // the including-fuel series. Only the exact ex-fuel basket excludes fuel.
  if (seriesId === `${prefix}-retail-sales-ex-fuel`) excluded.add(`${prefix}-retail-automotive-fuel`);
  return nodes.filter(node => !node.metricId || !excluded.has(node.metricId)).map(node => ({ ...node, children: node.children ? retailBasketComponents(node.children, region, seriesId) : undefined } as T));
}
export function releasePeriods(metrics: ReleaseMetrics, ...ids: string[]): string[] {
  return [...new Set(ids.flatMap(id => (metrics[id]?.history ?? []).filter(point => Number.isFinite(point.value)).map(point => point.date.slice(0, 7))))].sort().reverse();
}
export function includeReleasePeriod(periods: string[], releasePeriod?: string | null): string[] {
  return releasePeriod && /^\d{4}-\d{2}$/.test(releasePeriod) ? [...new Set([...periods, releasePeriod])].sort().reverse() : periods;
}
/** Compound three consecutive monthly price changes, then annualize. A missing
 * month must not silently shorten the comparison window. */
export function componentThreeMonthSaar(metric: ReleaseMetric | undefined, period: string): number | null {
  const rates = calendarWindow(period, 3).map(month => contributionRate(metric, month, "mom"));
  if (!rates.every((rate): rate is number => rate != null && Number.isFinite(rate) && rate > -100)) return null;
  const annualized = (rates.reduce((factor, rate) => factor * (1 + rate / 100), 1) ** 4 - 1) * 100;
  return Number.isFinite(annualized) ? annualized : null;
}
export function inflationReleaseRows(config: ContributionConfig, metrics: ContributionMetrics, period: string, core: boolean, mode: ContributionMode): ReleaseDriverRow[] {
  const result = buildInflationContributions(config, metrics, period, core, mode);
  const leaves = result.rows.filter(row => !row.subtotal);
  const effects = leaves.some(row => row.current != null);
  const history = calendarWindow(period).map(month => ({ month, rows: buildInflationContributions(config, metrics, month, core, mode).rows }));
  // The first monthly comparison starts at t-3; its shares also provide the
  // comparison-base weights for the complete three-month CPI price change.
  const threeMonthBaseRows = config.headline === "us-cpi"
    ? buildInflationContributions(config, metrics, calendarWindow(period, 3)[0], core, "mom").rows
    : [];
  return leaves.map(row => ({
    id: row.id, metricId: row.id, label: row.label,
    weight: row.weight && (row.weight.basis.includes("monthly relative importance") || (row.weight.year === Number(period.slice(0, 4)) && period >= row.weight.validFrom)) ? row.share : null,
    weightSource: row.weight?.source, weightNote: row.weight?.basis,
    rate: row.currentRate, current: row.current,
    previous: effects ? row.previous : history.at(-2)?.rows.find(point => point.id === row.id)?.currentRate ?? null,
    classification: classifyCpiDriver(row.id),
    history: history.map(item => { const value = item.rows.find(point => point.id === row.id); return { period: item.month, value: effects ? value?.current ?? null : value?.currentRate ?? null }; }),
    rateHistory: history.map(item => ({ period: item.month, value: item.rows.find(point => point.id === row.id)?.currentRate ?? null })),
    effectHistory: history.map(item => ({ period: item.month, value: item.rows.find(point => point.id === row.id)?.current ?? null })),
    ...(config.headline === "us-cpi" ? (() => {
      const threeMonthSaar = componentThreeMonthSaar(metrics[row.id], period);
      const share = threeMonthBaseRows.find(base => base.id === row.id)?.share ?? null;
      return { threeMonthSaar, threeMonthEffect: threeMonthSaar != null && share != null ? threeMonthSaar * share / 100 : null };
    })() : {}),
  }));
}
export function indexReleaseRows(nodes: ReleaseNode[], metrics: ReleaseMetrics, period: string, mode: ContributionMode): ReleaseDriverRow[] {
  const priorPeriod = previousContributionMonth(period);
  return disjointNodes(nodes).map(node => {
    const rateAt = (month: string) => contributionRate(metrics[node.metricId!], month, mode);
    return { id: node.id, metricId: node.metricId, label: node.label, weight: null,
      weightNote: "A matching expenditure weight is not mapped for this component.",
      rate: rateAt(period), current: null, previous: rateAt(priorPeriod), classification: "unclassified",
      history: calendarWindow(period).map(month => ({ period: month, value: rateAt(month) })),
      rateHistory: calendarWindow(period).map(month => ({ period: month, value: rateAt(month) })),
    };
  });
}

/** PCE has no BEA-published sticky/flexible flag. This is a display proxy based
 * on BEA's product type: goods are grouped as more flexible, services as
 * stickier. It must not be presented as an official Atlanta Fed PCE series. */
export function classifyPceProxy(id: string): "sticky" | "flexible" | "unclassified" {
  if (["us-pce-housing", "us-pce-housing-utilities", "us-pce-healthcare", "us-pce-transport-services", "us-pce-recreation-services", "us-pce-food-services", "us-pce-financial-services", "us-pce-other-services"].includes(id)) return "sticky";
  if (["us-pce-motor-vehicles", "us-pce-furnishings", "us-pce-recreational-goods", "us-pce-other-durable-goods", "us-pce-clothing", "us-pce-food", "us-pce-energy", "us-pce-other-nondurable-goods"].includes(id)) return "flexible";
  return "unclassified";
}
/** Approximate PCE effects using BEA expenditure shares and price-index changes.
 * These are not official Fisher-chain contributions, and require matching months. */
export function pceReleaseRows(nodes: ReleaseNode[], metrics: ReleaseMetrics, period: string, mode: ContributionMode, core: boolean): ReleaseDriverRow[] {
  const rows = indexReleaseRows(nodes, metrics, period, mode);
  const valueAt = (id: string, month: string) => (metrics[id]?.history ?? []).filter(point => point.date.slice(0, 7) === month && Number.isFinite(point.value)).at(-1)?.value ?? null;
  const expenditureShareAt = (id: string, month: string) => {
    const spendId = PCE_COMPONENT_EXPENDITURE[id];
    if (!spendId) return null;
    const numerator = valueAt(spendId, month), denominator = valueAt(core ? "us-pce-spend-core" : "us-pce-spend-total", month);
    return numerator != null && numerator >= 0 && denominator != null && denominator > 0 ? numerator / denominator * 100 : null;
  };
  // Average the two adjacent current-dollar expenditure shares used by the
  // requested Fisher-style display weight: w(i,t) = 0.5*s(i,t-1) + 0.5*s(i,t).
  // These are analytical weights, not BEA-published chain contributions.
  const weightAt = (id: string, month: string, comparisonMonth = previousContributionMonth(month)) => {
    const previousShare = expenditureShareAt(id, comparisonMonth);
    const currentShare = expenditureShareAt(id, month);
    return previousShare != null && currentShare != null ? (previousShare + currentShare) / 2 : null;
  };
  return rows.map(row => {
    const effectHistory = row.rateHistory!.map(point => { const weight = weightAt(row.metricId!, point.period); return { period: point.period, value: weight != null && point.value != null ? weight * point.value / 100 : null }; });
    const weight = weightAt(row.metricId!, period);
    const threeMonthSaar = componentThreeMonthSaar(metrics[row.metricId!], period);
    const threeMonthWeight = weightAt(row.metricId!, period, previousContributionMonth(calendarWindow(period, 3)[0]));
    const threeMonthEffect = threeMonthSaar != null && threeMonthWeight != null ? threeMonthWeight * threeMonthSaar / 100 : null;
    return { ...row, classification: classifyPceProxy(row.metricId!), weight, weightSource: "https://apps.bea.gov/iTable/?categories=survey&isuri=1&nipa_table_list=70&reqid=19&step=3", weightNote: "Display weight = 50% of the component's BEA Table 2.8.5 expenditure share in t−1 + 50% in t. Estimated analytical weight; BEA does not publish it as an official fixed weight or component contribution.", current: effectHistory.at(-1)?.value ?? null, previous: effectHistory.at(-2)?.value ?? null, effectHistory, threeMonthSaar, threeMonthEffect };
  });
}
export function retailReleaseRows(nodes: ReleaseNode[], metrics: ReleaseMetrics, period: string, mode: ContributionMode): ReleaseDriverRow[] {
  const priorPeriod = previousContributionMonth(period);
  return disjointNodes(nodes).map(node => {
    const weight = getOfficialRetailIndexWeight(node.metricId);
    const rateAt = (month: string) => retailDriverRate(metrics, node.metricId!, mode, month);
    return { id: node.id, metricId: node.metricId, label: node.label, weight: weight?.value ?? null,
      weightSource: weight?.source, weightNote: weight ? `${weight.basis}. Reference weight only; not used to estimate this release's contribution.` : "A matching category weight is not mapped. No weighted effect is inferred.",
      rate: rateAt(period), current: null, previous: rateAt(priorPeriod), classification: "unclassified",
      history: calendarWindow(period).map(month => ({ period: month, value: rateAt(month) })),
      rateHistory: calendarWindow(period).map(month => ({ period: month, value: rateAt(month) })),
    };
  });
}
