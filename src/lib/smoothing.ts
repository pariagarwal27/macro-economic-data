/**
 * Desk smoothing helpers — industry-standard transforms for cross-economy comparison.
 *
 * CPI / retail (MoM): 3-month compounded, annualized
 *   ann = ( Π(1 + m_i/100) )^4 − 1,  i ∈ {t−2, t−1, t}
 *
 * Wages (index level): 3-month / 3-month annualized
 *   ann = ( level_t / level_{t−3} )^4 − 1
 *
 * Unemployment / payrolls: 3-month arithmetic moving average of the published print.
 */

export interface SeriesPoint {
  date: string;
  value: number;
  rawValue?: number | null;
}

/** Shift a YYYY-MM-01 period by `deltaMonths` (can be negative). */
export function shiftPeriod(period: string, deltaMonths: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function seriesToMap(series: SeriesPoint[]): Map<string, SeriesPoint> {
  const map = new Map<string, SeriesPoint>();
  for (const p of series) {
    if (Number.isFinite(p.value)) map.set(p.date, p);
  }
  return map;
}

/**
 * Consecutive periods ending at `anchorPeriod` (inclusive).
 * Returns null if the anchor month is unreleased or any lag is missing.
 * `stepMonths`: 1 for monthly series, 3 for quarterly.
 */
export function windowEndingAt(
  seriesMap: Map<string, SeriesPoint>,
  anchorPeriod: string,
  count: number,
  stepMonths = 1
): SeriesPoint[] | null {
  if (!seriesMap.has(anchorPeriod)) return null;

  const points: SeriesPoint[] = [];
  for (let lag = count - 1; lag >= 0; lag--) {
    const date = shiftPeriod(anchorPeriod, -lag * stepMonths);
    const p = seriesMap.get(date);
    if (!p || !Number.isFinite(p.value)) return null;
    points.push(p);
  }
  return points;
}

/** @deprecated Use windowEndingAt — avoids forward-filling unreleased months. */
export function windowAtOrBefore(
  series: SeriesPoint[],
  period: string,
  count: number
): SeriesPoint[] {
  const eligible = [...series]
    .filter((p) => p.date <= period && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (eligible.length < count) return [];
  return eligible.slice(-count);
}

/** 3-month arithmetic mean of the published values. */
export function movingAverage3(values: number[]): number | null {
  if (values.length < 3) return null;
  const slice = values.slice(-3);
  if (slice.some((v) => !Number.isFinite(v))) return null;
  return slice.reduce((a, b) => a + b, 0) / 3;
}

export interface AnnualizeWindowOpts {
  /** Number of period-on-period % prints to compound (default 3). */
  window?: number;
  /** Periods per year for annualization — 12 monthly, 4 quarterly (default 12). */
  periodsPerYear?: number;
}

/**
 * Compound the last N period-on-period % prints and annualize.
 * Monthly (wages, CPI): window=3, periodsPerYear=12 → exponent 4.
 * Quarterly (EA wages): window=3, periodsPerYear=4 → exponent 4/3.
 */
export function annualized3mFromMom(
  momPcts: number[],
  opts: AnnualizeWindowOpts = {}
): number | null {
  const window = opts.window ?? 3;
  const periodsPerYear = opts.periodsPerYear ?? 12;
  if (momPcts.length < window) return null;
  const m = momPcts.slice(-window);
  if (m.some((v) => !Number.isFinite(v))) return null;
  const compounded = m.reduce((acc, pct) => acc * (1 + pct / 100), 1);
  return (Math.pow(compounded, periodsPerYear / window) - 1) * 100;
}

/**
 * 3m/3m annualized from an index level (wages, etc.).
 * Requires current level and level 3 periods earlier.
 */
export function annualized3mFromIndex(levels: number[]): number | null {
  if (levels.length < 4) return null;
  const cur = levels[levels.length - 1]!;
  const lag3 = levels[levels.length - 4]!;
  if (!Number.isFinite(cur) || !Number.isFinite(lag3) || lag3 === 0) return null;
  return (Math.pow(cur / lag3, 4) - 1) * 100;
}

/** Pick index level: raw_value when present (YoY metrics store the index there). */
export function indexLevel(p: SeriesPoint): number {
  return p.rawValue != null && Number.isFinite(p.rawValue) ? p.rawValue : p.value;
}

export function roundSmooth(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
