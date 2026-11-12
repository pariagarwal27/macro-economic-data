export type DailyExpectationSelection = { from: string; to: string };

export function usesDailyExpectationWindow(ids: string[]) {
  return ids.length > 0 && ids.every(id => id === "uk-inflation-comp-5y" || id === "uk-inflation-comp-5y5y");
}

/** 45 calendar days, ending at the latest published observation. Keep history intact. */
export function getDailyExpectationRange(dates: string[], selection?: DailyExpectationSelection | null) {
  if (!dates.length) return { startIndex: 0, endIndex: 0 };
  const latest = dates.at(-1)!;
  const cutoff = new Date(`${latest}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 44);
  const from = selection?.from ?? cutoff.toISOString().slice(0, 10);
  const to = selection?.to ?? latest;
  const first = dates.findIndex(date => date >= from);
  const startIndex = first < 0 ? dates.length - 1 : first;
  let endIndex = dates.length - 1;
  while (endIndex > startIndex && dates[endIndex]! > to) endIndex--;
  return { startIndex, endIndex };
}

export function formatDailyExpectationDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
