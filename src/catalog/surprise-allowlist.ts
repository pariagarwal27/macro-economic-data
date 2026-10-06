/**
 * Surprise-layer config — separate from raw Investing dumps.
 * Original month JSON + calendar_events stay untouched; this only governs QA / future UI.
 */
export type SurpriseVerdict = "allow" | "review" | "deny";

export interface SurpriseMetricRule {
  metricId: string;
  /** Max |Investing actual − official obs| to count as aligned (after scale). */
  maxAbsDiff: number;
  /** Multiply Investing actual/expected before comparing to observations (e.g. 0.001 for NFP K→thousands). */
  investingScale?: number;
  /** Human note shown in audit MD. */
  notes?: string;
}

/** Candidate metrics for the 1y surprise test (not yet UI-wired). */
export const SURPRISE_CANDIDATES: SurpriseMetricRule[] = [
  { metricId: "us-cpi-yoy", maxAbsDiff: 0.15, notes: "YoY % — expect tight match to FRED" },
  { metricId: "us-cpi-mom", maxAbsDiff: 0.15, notes: "MoM % only (explicit MoM in title)" },
  { metricId: "us-core-cpi-yoy", maxAbsDiff: 0.15 },
  { metricId: "us-core-cpi-mom", maxAbsDiff: 0.15 },
  {
    metricId: "us-nfp",
    maxAbsDiff: 80,
    investingScale: 0.001,
    notes: "calendar_events keep K units; releases scale to thousands (PAYEMS diff)",
  },
  {
    metricId: "us-adp-change",
    maxAbsDiff: 25000,
    investingScale: 1,
    notes: "Investing and current ADP obs appear same magnitude (not ÷1000)",
  },
  { metricId: "us-unemployment", maxAbsDiff: 0.25 },
  { metricId: "us-retail-sales", maxAbsDiff: 0.35 },
  { metricId: "us-core-pce", maxAbsDiff: 0.15 },
  { metricId: "uk-cpi-yoy", maxAbsDiff: 0.25, notes: "Requires YoY in title — not CPI index" },
  { metricId: "uk-core-cpi-yoy", maxAbsDiff: 0.25 },
  { metricId: "ea-hicp-yoy", maxAbsDiff: 0.25, notes: "Requires YoY — not index/MoM" },
  { metricId: "ea-core-hicp-yoy", maxAbsDiff: 0.25 },
  { metricId: "de-cpi-yoy", maxAbsDiff: 0.35, notes: "National German CPI/HICP YoY only" },
  { metricId: "fr-cpi-yoy", maxAbsDiff: 0.35 },
];

export const SURPRISE_AUDIT_DEFAULTS = {
  /** Inclusive lower bound on release time (UTC ISO date prefix ok). */
  since: "2025-08-09",
  /** Output directory relative to repo root — never writes into month dumps. */
  outDir: "data/investing/surprise",
};
