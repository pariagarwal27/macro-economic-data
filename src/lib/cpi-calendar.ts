import type { CalendarActual, CalendarCompletion } from "./economic-calendar-view";
import { previousContributionMonth } from "./inflation-contributions";
import { applyTransform } from "@/ingest/transforms";

/** BLS publishes the CPI index; the dashboard's MoM rates are derived from it. */
export const CPI_RATE_SOURCES: Readonly<Record<string, string>> = {
  "us-cpi-mom": "us-cpi",
  "us-core-cpi-mom": "us-cpi-core",
};

/** Reuse the released CPI index reading for its dashboard-derived MoM calendar row. */
export function canonicalCpiCalendarActuals(
  actuals: CalendarActual[],
  completions: CalendarCompletion[],
  histories: ReadonlyMap<string, { date: string; value: number }[]>,
) {
  let updatedActuals = actuals;
  let updatedCompletions = completions;

  for (const [metricId, sourceId] of Object.entries(CPI_RATE_SOURCES)) {
    const history = histories.get(sourceId);
    if (!history?.length) continue;
    const rates = applyTransform(history, "pct_change_mom");
    const derived = actuals
      .filter(actual => actual.metricId === sourceId && actual.periodDate)
      .flatMap(sourceActual => {
        const period = sourceActual.periodDate!.slice(0, 7);
        const value = rates.find(point => point.date === sourceActual.periodDate)?.value;
        if (value == null) return [];

        const saved = actuals.find(row => row.metricId === metricId && row.periodDate === sourceActual.periodDate);
        const priorPeriod = previousContributionMonth(period);
        const priorPeriodValue = rates.find(point => point.date.slice(0, 7) === priorPeriod)?.value;

        return [{
          ...sourceActual,
          metricId,
          value,
          expectedValue: saved?.expectedValue ?? null,
          priorPeriodValue: priorPeriodValue ?? saved?.priorPeriodValue ?? null,
        }];
      });

    if (!derived.length) continue;
    updatedActuals = [...updatedActuals.filter(actual => actual.metricId !== metricId), ...derived];
    updatedCompletions = [
      ...updatedCompletions.filter(completion => completion.metricId !== metricId),
      ...completions
        .filter(completion => completion.metricId === sourceId)
        .map(completion => ({ ...completion, metricId })),
    ];
  }

  return { actuals: updatedActuals, completions: updatedCompletions };
}
