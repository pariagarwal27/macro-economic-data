export type ExpectationAxis = "left" | "right";

export type ExpectationChartGroup = {
  key: string;
  title: string;
  note: string;
  series: Array<{ id: string; axis?: ExpectationAxis }>;
};

export const EXPANDED_EXPECTATION_GROUP_IDS = new Set([
  "us-inflation-expectations-market",
  "us-inflation-expectations-model",
]);

export const MARKERLESS_EXPECTATION_GROUP_IDS = new Set([
  "us-inflation-expectations-market",
]);

/** Axis assignments for the NY Fed household, wage, and labor comparisons. */
export const NYFED_EXPECTATION_AXIS_BY_METRIC_ID: Record<string, ExpectationAxis> = {
  "us-nyfed-sce-finance-income-1y": "left",
  "us-nyfed-sce-finance-spending-1y": "right",
  "us-nyfed-sce-labor-earnings-1y": "left",
  "us-nyfed-sce-labor-job-separation-1y": "left",
  "us-nyfed-sce-labor-job-finding-1y": "right",
  "us-nyfed-sce-labor-unemployment-1y": "right",
};

export const NYFED_OVERVIEW_CHART_GROUPS = {
  payGrowth: {
    key: "pay-growth",
    title: "Atlanta Fed Wage Growth Tracker",
    note: "Atlanta Fed median nominal wage growth (3-month overall series).",
    ids: ["us-atlanta-wage"],
  },
  inflation: {
    key: "nyfed-inflation",
    title: "NY Fed SCE Inflation Expectations",
    note: "1Y, 3Y and 5Y household inflation expectations.",
    ids: ["us-nyfed-sce-1y", "us-nyfed-sce-3y", "us-nyfed-sce-5y"],
  },
  household: {
    key: "nyfed-household",
    title: "NY Fed SCE Household Financial Expectations",
    note: "Expected household income, nominal spending and earnings growth.",
    ids: [
      "us-nyfed-sce-finance-income-1y",
      "us-nyfed-sce-finance-spending-1y",
      "us-nyfed-sce-labor-earnings-1y",
    ],
  },
  laborMarket: {
    key: "labor-market-probabilities",
    title: "NY Fed SCE Labor Market Probabilities",
    note: "Job-finding probability within three months after job loss, job separation risk and higher-unemployment expectations.",
    ids: [
      "us-nyfed-sce-labor-job-separation-1y",
      "us-nyfed-sce-labor-job-finding-1y",
      "us-nyfed-sce-labor-unemployment-1y",
    ],
  },
} as const;

/** Explicit pairings for expectation tabs where unlike horizons need separate scales. */
export const EXPECTATION_CHART_GROUPS: Record<string, ExpectationChartGroup[]> = {
  "us-inflation-expectations-business": [
    {
      key: "atlanta-bie",
      title: "Atlanta Fed BIE",
      note: "Monthly 1Y business inflation expectations.",
      series: [{ id: "us-atlanta-bie-1y" }],
    },
    {
      key: "cleveland-sofie-1y-5y",
      title: "Cleveland Fed SoFIE · 1Y & 5Y",
      note: "1-Year expectations on the left axis · 5-Year expectations on the right axis.",
      series: [
        { id: "us-cleveland-sofie-1y", axis: "left" },
        { id: "us-cleveland-sofie-5y", axis: "right" },
      ],
    },
  ],
  "us-inflation-expectations-market": [
    {
      key: "breakeven-5y",
      title: "Market Inflation Compensation · 5Y",
      note: "5-Year breakeven inflation.",
      series: [{ id: "us-breakeven-5y" }],
    },
    {
      key: "breakeven-5y5y-10y",
      title: "Market Inflation Compensation · 5Y5Y & 10Y",
      note: "5Y5Y forward breakeven and 10-Year breakeven inflation.",
      series: [
        { id: "us-5y5y-forward" },
        { id: "us-breakeven-10y" },
      ],
    },
  ],
  "us-inflation-expectations-model": [
    {
      key: "cleveland-1y-3y",
      title: "Cleveland Fed Expectations · 1Y & 3Y",
      note: "1-Year expectations on the left axis · 3-Year expectations on the right axis.",
      series: [
        { id: "us-cleveland-exp-inf-1y", axis: "left" },
        { id: "us-cleveland-exp-inf-3y", axis: "right" },
      ],
    },
    {
      key: "cleveland-5y-10y",
      title: "Cleveland Fed Expectations · 5Y & 10Y",
      note: "5-Year expectations on the left axis · 10-Year expectations on the right axis.",
      series: [
        { id: "us-cleveland-exp-inf-5y", axis: "left" },
        { id: "us-cleveland-exp-inf-10y", axis: "right" },
      ],
    },
  ],
  "uk-inflation-expectations-professional": [
    {
      key: "maps-1y-2y",
      title: "BoE Market Participants Survey · 1Y & 2Y",
      note: "1-Year expectations on the left axis · 2-Year expectations on the right axis.",
      series: [
        { id: "uk-maps-inflation-1y", axis: "left" },
        { id: "uk-maps-inflation-2y", axis: "right" },
      ],
    },
    {
      key: "maps-3y-5y",
      title: "BoE Market Participants Survey · 3Y & 5Y",
      note: "3-Year expectations on the left axis · 5-Year expectations on the right axis.",
      series: [
        { id: "uk-maps-inflation-3y", axis: "left" },
        { id: "uk-maps-inflation-5y", axis: "right" },
      ],
    },
  ],
};
