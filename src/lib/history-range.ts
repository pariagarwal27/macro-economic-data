export type HistoryYearRange = { from: number; to: number };
export type HistoryRangeHandle = "from" | "to";

export function retainHistoryRangeIdentity(current: HistoryYearRange, next: HistoryYearRange): HistoryYearRange {
  return current.from === next.from && current.to === next.to ? current : next;
}

export function getNearestHistoryRangeHandle(index: number, fromIndex: number, toIndex: number): HistoryRangeHandle {
  return Math.abs(index - fromIndex) <= Math.abs(index - toIndex) ? "from" : "to";
}

export function getHistoryHandleForYearClick(index: number, fromIndex: number, toIndex: number, rangeActive: boolean): HistoryRangeHandle | null {
  if (!rangeActive && index === toIndex) return null;
  return getNearestHistoryRangeHandle(index, fromIndex, toIndex);
}

export function getInitialHistoryHandleRange(years: number[]): HistoryYearRange {
  const latestYear = years.at(-1) ?? 2026;
  return { from: years[Math.max(0, years.length - 2)] ?? latestYear, to: latestYear };
}

export function getInitialHistoryPlotRange(years: number[]): HistoryYearRange {
  const latestYear = years.at(-1) ?? 2026;
  return { from: latestYear, to: latestYear };
}

export function getHistoryYears(dates: string[], maxYear = Number.POSITIVE_INFINITY): number[] {
  const availableYears = dates
    .map(date => Number(String(date).slice(0, 4)))
    .filter(year => Number.isInteger(year) && year <= maxYear);
  if (!availableYears.length) return [];

  const latestYear = Math.max(...availableYears);
  const firstYear = Math.max(Math.min(...availableYears), latestYear - 9);
  return Array.from({ length: latestYear - firstYear + 1 }, (_, index) => firstYear + index);
}

export function normalizeHistoryYearRange(range: HistoryYearRange, years: number[]): HistoryYearRange {
  if (!years.length) return { from: 0, to: 0 };

  const minYear = years[0]!;
  const maxYear = years.at(-1)!;
  const from = Math.max(minYear, Math.min(maxYear, Math.round(range.from)));
  const to = Math.max(minYear, Math.min(maxYear, Math.round(range.to)));
  return { from, to: Math.max(from, to) };
}

export function filterHistoryByYearRange<T extends { date: string }>(data: T[], fromYear: number, toYear: number): T[] {
  const firstYear = Math.min(fromYear, toYear);
  const lastYear = Math.max(fromYear, toYear);
  return data.filter(point => {
    const year = Number(String(point.date).slice(0, 4));
    return Number.isInteger(year) && year >= firstYear && year <= lastYear;
  });
}

/** Default chart window: the latest observation back through the same period one year earlier. */
export function filterHistoryToTrailing12Months<T extends { date: string }>(data: T[]): T[] {
  const parseDate = (value: string): { month: number; exactDay: number } | null => {
    const date = String(value);
    const quarter = date.match(/^(\d{4})[- ]Q([1-4])$/i);
    if (quarter) return { month: Number(quarter[1]) * 12 + Number(quarter[2]) * 3 - 1, exactDay: Number.NaN };
    const iso = date.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!iso) return null;
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3] ?? 1);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const timestamp = /T\d{2}:\d{2}/.test(date) ? Date.parse(date) : Date.UTC(year, month - 1, day);
    return { month: year * 12 + month - 1, exactDay: Number.isFinite(timestamp) ? timestamp : Date.UTC(year, month - 1, day) };
  };
  const valid = data.flatMap(point => {
    const parsed = parseDate(point.date);
    return parsed == null ? [] : [{ point, ...parsed }];
  });
  if (!valid.length) return [];
  const latestMonth = Math.max(...valid.map(item => item.month));
  const latestInMonth = valid.filter(item => item.month === latestMonth);
  const hasTimestampObservations = valid.some(item => /T\d{2}:\d{2}/.test(item.point.date));
  const hasMultipleDailyObservations = hasTimestampObservations || new Set(latestInMonth.map(item => item.exactDay)).size > 1;
  if (hasMultipleDailyObservations) {
    const latestDay = Math.max(...valid.map(item => item.exactDay).filter(Number.isFinite));
    const latestDate = new Date(latestDay);
    const cutoffYear = latestDate.getUTCFullYear() - 1;
    const cutoffMonth = latestDate.getUTCMonth();
    const cutoffDate = Math.min(latestDate.getUTCDate(), new Date(Date.UTC(cutoffYear, cutoffMonth + 1, 0)).getUTCDate());
    const cutoffDay = Date.UTC(cutoffYear, cutoffMonth, cutoffDate);
    return valid.filter(item => Number.isFinite(item.exactDay) && item.exactDay >= cutoffDay && item.exactDay <= latestDay).map(item => item.point);
  }
  return valid.filter(item => item.month >= latestMonth - 12 && item.month <= latestMonth).map(item => item.point);
}

export function isYearInRange(date: string, fromYear: number, toYear: number): boolean {
  const year = Number(String(date).slice(0, 4));
  return Number.isInteger(year) && year >= Math.min(fromYear, toYear) && year <= Math.max(fromYear, toYear);
}
