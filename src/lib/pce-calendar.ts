import type { CalendarActual, CalendarCompletion } from "./economic-calendar-view";
import { previousContributionMonth } from "./inflation-contributions";
import { PCE_RATE_SOURCES, pceRate } from "./pce-release";

/** A released index is sufficient to publish its MoM/YoY calendar values. */
export function canonicalPceCalendarActuals(actuals: CalendarActual[], completions: CalendarCompletion[], histories: ReadonlyMap<string, { date: string; value: number }[]>) {
  let updatedActuals = actuals;
  let updatedCompletions = completions;
  for (const [metricId, source] of Object.entries(PCE_RATE_SOURCES)) {
    const history = histories.get(source.indexId);
    if (!history?.length) continue;
    const metrics = { [source.indexId]: { meta: { unit: "index" }, history } };
    const derived = actuals.filter(actual => actual.metricId === source.indexId && actual.periodDate).flatMap(actual => {
      const period = actual.periodDate!.slice(0, 7);
      const value = pceRate(metrics, source.indexId === "us-core-pce", period, source.mode);
      if (value == null) return [];
      const saved = actuals.find(row => row.metricId === metricId && row.periodDate === actual.periodDate);
      return [{ ...actual, metricId, value, expectedValue: saved?.expectedValue ?? null,
        priorPeriodValue: pceRate(metrics, source.indexId === "us-core-pce", previousContributionMonth(period), source.mode) }];
    });
    if (!derived.length) continue;
    updatedActuals = [...updatedActuals.filter(actual => actual.metricId !== metricId), ...derived];
    updatedCompletions = [
      ...updatedCompletions.filter(completion => completion.metricId !== metricId),
      ...completions.filter(completion => completion.metricId === source.indexId).map(completion => ({ ...completion, metricId })),
    ];
  }
  return { actuals: updatedActuals, completions: updatedCompletions };
}
