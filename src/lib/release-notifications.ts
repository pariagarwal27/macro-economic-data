import { DASHBOARD, type Region, type UiNode } from "@/components/macro-ui-hierarchy";
import { releaseCardTarget } from "./release-card-targets";
import { PCE_EXPENDITURE_LINES } from "./pce-expenditure";

export type ReleaseUpdate = { id: number; metricId: string; periodDate: string; releasedAt: string; value: number; stage: string | null };
export type ReleaseOpening = { key: string; region: Region; metricId: string; title: string; periodDate: string; releasedAt: string };
type Target = Pick<ReleaseOpening, "region" | "metricId" | "title"> & { cardId: string };

const targets = new Map<string, Target>();
for (const region of ["US", "UK", "EA"] as Region[]) {
  for (const spec of Object.values(DASHBOARD[region]).flat()) {
    const target = { region, metricId: spec.metricId, title: spec.title ?? spec.id, cardId: spec.id };
    if (!targets.has(spec.metricId)) targets.set(spec.metricId, target);
  }
}
for (const region of ["US", "UK", "EA"] as Region[]) {
  for (const spec of Object.values(DASHBOARD[region]).flat()) {
    const target = { region, metricId: spec.metricId, title: spec.title ?? spec.id, cardId: spec.id };
    const add = (id?: string) => { if (id && !targets.has(id)) targets.set(id, target); };
    [spec.yoyMetricId, spec.momMetricId].forEach(add);
  }
}
// Some rate aliases belong to a card but are not listed as its hierarchy IDs.
for (const id of ["us-pce-yoy", "us-pce-mom", "us-core-pce-yoy", "us-core-pce-mom"]) {
  const root = releaseCardTarget(id)?.rootId;
  const target = root && targets.get(root);
  if (target) targets.set(id, target);
}
for (const id of Object.keys(PCE_EXPENDITURE_LINES)) {
  const target = targets.get(id === "us-pce-spend-core" ? "us-core-pce" : "us-pce");
  if (target) targets.set(id, target);
}
for (const region of ["US", "UK", "EA"] as Region[]) {
  for (const spec of Object.values(DASHBOARD[region]).flat()) {
    const target = { region, metricId: spec.metricId, title: spec.title ?? spec.id, cardId: spec.id };
    const add = (id?: string) => { if (id && !targets.has(id)) targets.set(id, target); };
    const visit = (nodes: UiNode[] = []) => nodes.forEach(node => { add(node.metricId); add(node.momMetricId); visit(node.children); });
    visit(spec.components);
    (spec.chartMetricIds ?? []).forEach(add);
  }
}
// Core PCE uses the housing index (line 29) while headline uses the broader
// housing-and-utilities category (line 15).
const corePceTarget = targets.get("us-core-pce");
if (corePceTarget) targets.set("us-pce-housing", corePceTarget);

export function dashboardReleaseTarget(metricId: string): Target | null {
  return targets.get(metricId) ?? null;
}

export function buildReleaseOpenings(updates: readonly ReleaseUpdate[], now = Date.now()): ReleaseOpening[] {
  const openings = updates.flatMap(update => {
    const target = dashboardReleaseTarget(update.metricId);
    const released = Date.parse(update.releasedAt);
    if (!target || !Number.isFinite(released) || released > now + 60_000 || now - released > 86_400_000) return [];
    const monthlyInflation = /(?:cpi|cpih|hicp|pce)/i.test(target.metricId);
    const period = monthlyInflation ? update.periodDate.slice(0, 7) : update.periodDate;
    const key = [target.region, target.cardId, period, update.releasedAt.slice(0, 10), update.stage ?? "release"].join(":");
    return [{ ...target, key, periodDate: update.periodDate, releasedAt: update.releasedAt }];
  });

  // On US release days, open the headline CPI/PCE or payrolls card in
  // preference to other metrics published in the same update batch.
  const hasPriorityUsRelease = openings.some(opening => opening.region === "US" &&
    ["us-cpi-card", "us-pce-card", "us-payrolls-card"].includes(dashboardReleaseTarget(opening.metricId)?.cardId ?? ""));
  if (!hasPriorityUsRelease) return openings;
  return openings.filter(opening => opening.region !== "US" ||
    ["us-cpi-card", "us-pce-card", "us-payrolls-card"].includes(dashboardReleaseTarget(opening.metricId)?.cardId ?? ""));
}

export function enqueueReleaseOpenings(queue: ReleaseOpening[], openings: readonly ReleaseOpening[], seen: Set<string>): ReleaseOpening[] {
  const result = [...queue];
  for (const opening of openings) {
    if (seen.has(opening.key)) continue;
    seen.add(opening.key);
    result.push(opening);
  }
  return result;
}

export function mergeReleaseUpdates<T extends { history: Array<{ date: string; value: number }>; displayReleasedAt?: string | null }>(metrics: Record<string, T>, updates: readonly ReleaseUpdate[]): Record<string, T> {
  let result = metrics;
  for (const update of updates) {
    const metric = result[update.metricId];
    if (!metric || !Number.isFinite(update.value) || (metric.displayReleasedAt && metric.displayReleasedAt > update.releasedAt)) continue;
    if (result === metrics) result = { ...metrics };
    const history = metric.history.filter(point => point.date !== update.periodDate);
    history.push({ date: update.periodDate, value: update.value });
    history.sort((a, b) => a.date.localeCompare(b.date));
    result[update.metricId] = { ...metric, history, displayReleasedAt: !metric.displayReleasedAt || update.releasedAt > metric.displayReleasedAt ? update.releasedAt : metric.displayReleasedAt };
  }
  return result;
}
