/** Smoothed cross-economy desk rows — 3m averages / 3m/3m annualized. */

import type { ColumnRule, DeskRegion } from "./desk-matrix";

export type SmoothMethod =
  | "ann3m_mom" // CPI, core, retail — compound 3 MoM prints, annualize
  | "ann3m_index" // Wages — index level t vs t-3, annualize
  | "ma3"; // UE, payrolls — 3-month rolling average

export const SMOOTH_METHOD_SHORT: Record<SmoothMethod, string> = {
  ann3m_mom: "3m/3m ann.",
  ann3m_index: "3m/3m ann. (index)",
  ma3: "3m avg",
};

export interface DeskSmoothedRowDef {
  id: string;
  label: string;
  method: SmoothMethod;
  us: string;
  uk: string;
  ea: string;
  methodByRegion?: Partial<Record<DeskRegion, SmoothMethod>>;
  /** Annualization frequency — 12 for monthly MoM, 4 for quarterly QoQ (EA wages). */
  periodsPerYearByRegion?: Partial<Record<DeskRegion, number>>;
  columnRule?: ColumnRule;
  columnRuleByRegion?: Partial<Record<DeskRegion, ColumnRule>>;
  /** Optional footnote shown under the table title. */
  note?: string;
}

export const DESK_SMOOTHED_ROWS: DeskSmoothedRowDef[] = [
  {
    id: "cpi-ann3m",
    label: "CPI",
    method: "ann3m_mom",
    us: "us-cpi-mom",
    uk: "uk-cpi-mom",
    ea: "ea-hicp-mom",
  },
  {
    id: "core-cpi-ann3m",
    label: "Core CPI",
    method: "ann3m_mom",
    us: "us-core-cpi-mom",
    uk: "uk-core-cpi-mom",
    ea: "ea-core-hicp-mom",
  },
  {
    id: "unemployment-ma3",
    label: "Unemployment rate",
    method: "ma3",
    us: "us-unemployment",
    uk: "uk-unemployment",
    ea: "ea-unemployment",
    note: "UK: ILO rate (3m average); bulletin overlay when MGSX lags.",
  },
  {
    id: "payrolls-ma3",
    label: "Employment change",
    method: "ma3",
    us: "us-nfp",
    uk: "uk-employment-change",
    ea: "ea-employment-change",
    columnRule: "monthly",
    columnRuleByRegion: { EA: "quarter" },
    periodsPerYearByRegion: { EA: 4 },
    note: "EA: quarterly LFS change (Mar/Jun/Sep/Dec cols); Q2 2026 not yet released.",
  },
  {
    id: "wages-ann3m",
    label: "Wages",
    method: "ann3m_mom",
    us: "us-ahe-mom",
    uk: "uk-paye-median-pay-mom",
    ea: "ea-wage-growth-qoq",
    periodsPerYearByRegion: { EA: 4 },
    columnRule: "monthly",
    columnRuleByRegion: { EA: "quarter" },
    note: "UK: PAYE RTI median pay MoM (timelier than LMS AWE).",
  },
  {
    id: "retail-ann3m",
    label: "Retail sales",
    method: "ann3m_mom",
    us: "us-retail-sales",
    uk: "uk-retail-sales-mom",
    ea: "ea-retail-sales-mom",
  },
];

export const SMOOTH_METHOD_LABELS: Record<SmoothMethod, string> = {
  ann3m_mom: "Compound last 3 period-on-period % → annualize (MoM ×4; EA wages QoQ ×4/3)",
  ann3m_index: "Index level t / t−3 → annualize (^4 − 1)",
  ma3: "Arithmetic mean of last 3 prints",
};

export function allDeskSmoothedMetricIds(): string[] {
  const ids = new Set<string>();
  for (const row of DESK_SMOOTHED_ROWS) {
    ids.add(row.us);
    ids.add(row.uk);
    ids.add(row.ea);
  }
  return [...ids];
}
