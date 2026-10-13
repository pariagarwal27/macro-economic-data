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
    {
      key: "cleveland-30y",
      title: "Cleveland Fed Expectations · 30Y",
      note: "30-Year expectations.",
      series: [{ id: "us-cleveland-exp-inf-30y" }],
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
