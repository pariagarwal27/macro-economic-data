"use client";

import { useState } from "react";

/** Advance an open card on a new release, preserving manual browsing during
 * same-month refreshes. An older notification opens the newest available month. */
export function useReleasePeriod(periods: string[], initialPeriod?: string | null, followReleases = true) {
  const latestPeriod = periods[0] ?? "";
  const releasePeriod = initialPeriod ?? "";
  const [selection, setSelection] = useState(() => ({
    period: followReleases ? latestPeriod : releasePeriod || latestPeriod,
    latestPeriod,
    releasePeriod,
  }));

  let current = selection;
  if (followReleases && (selection.latestPeriod !== latestPeriod || selection.releasePeriod !== releasePeriod)) {
    const newRelease = latestPeriod > selection.latestPeriod || Boolean(releasePeriod && releasePeriod !== selection.releasePeriod);
    current = { period: newRelease ? latestPeriod : selection.period, latestPeriod, releasePeriod };
    // Adjust before rendering the card's KPIs and chart so they use the same
    // release month as the dropdown on the first committed render.
    setSelection(current);
  }

  const period = periods.includes(current.period) ? current.period : latestPeriod;
  const selectPeriod = (value: string) => setSelection(current => ({ ...current, period: value }));
  return [period, selectPeriod] as const;
}
