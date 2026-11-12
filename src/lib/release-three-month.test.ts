import assert from "node:assert/strict";
import test from "node:test";
import { componentThreeMonthSaar, inflationReleaseRows, pceReleaseRows } from "./release-driver-adapters";
import type { ContributionConfig } from "./inflation-contributions";

const index = {
  meta: { unit: "index" },
  history: [
    { date: "2026-06-01", value: 100 },
    { date: "2026-07-01", value: 101 },
    { date: "2026-08-01", value: 102 },
    { date: "2026-09-01", value: 103 },
  ],
};
const saar = ((103 / 100) ** 4 - 1) * 100;
const near = (actual: number | null | undefined, expected: number) => {
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
};

test("three-month SAAR compounds consecutive monthly price changes and requires every month", () => {
  near(componentThreeMonthSaar(index, "2026-09"), saar);
  assert.equal(componentThreeMonthSaar({ ...index, history: index.history.filter(point => point.date !== "2026-08-01") }, "2026-09"), null);
  assert.equal(componentThreeMonthSaar(index, "2026-10"), null);
});

test("US CPI SAAR effects use comparison-start shares and core rebasing, independently of the MoM/YoY toggle", () => {
  const config: ContributionConfig = {
    title: "CPI", headline: "us-cpi", core: "us-cpi-core",
    components: [{ id: "us-cpi-food", label: "Food" }, { id: "us-cpi-shelter", label: "Shelter" }],
    coreComponents: [{ id: "us-cpi-shelter", label: "Shelter" }],
  };
  const metrics = {
    "us-cpi-food": { ...index, weightHistory: [{ date: "2026-06", value: 60 }, { date: "2026-08", value: 90 }] },
    "us-cpi-shelter": { ...index, weightHistory: [{ date: "2026-06", value: 40 }, { date: "2026-08", value: 10 }] },
  };
  for (const mode of ["mom", "yoy"] as const) {
    const headline = inflationReleaseRows(config, metrics, "2026-09", false, mode).find(row => row.id === "us-cpi-shelter")!;
    near(headline.threeMonthSaar, saar);
    near(headline.threeMonthEffect, saar * 0.4);
    const core = inflationReleaseRows(config, metrics, "2026-09", true, mode)[0];
    near(core.threeMonthEffect, saar);
  }
});

test("PCE SAAR effects use expenditure shares at t-3 and t for headline and core", () => {
  const nodes = [{ id: "health", metricId: "us-pce-healthcare", label: "Health care" }];
  const dollars = (values: number[]) => ({ meta: { unit: "usd" }, history: ["2026-06-01", "2026-08-01", "2026-09-01"].map((date, i) => ({ date, value: values[i] })) });
  const metrics = {
    "us-pce-healthcare": index,
    "us-pce-spend-healthcare": dollars([20, 40, 30]),
    "us-pce-spend-total": dollars([100, 100, 100]),
    "us-pce-spend-core": dollars([80, 80, 80]),
  };
  for (const mode of ["mom", "yoy"] as const) {
    const headline = pceReleaseRows(nodes, metrics, "2026-09", mode, false)[0];
    near(headline.threeMonthSaar, saar);
    near(headline.threeMonthEffect, saar * 0.25);
    const core = pceReleaseRows(nodes, metrics, "2026-09", mode, true)[0];
    near(core.threeMonthEffect, saar * (25 / 80));
  }
  const missingWeight = pceReleaseRows(nodes, { ...metrics, "us-pce-spend-healthcare": dollars([20, 40, 30]) }, "2026-08", "mom", false)[0];
  assert.equal(missingWeight.threeMonthEffect, null);
});

test("PCE retains the component SAAR rate when the comparison-start expenditure share is unavailable", () => {
  const row = pceReleaseRows([{ id: "health", metricId: "us-pce-healthcare", label: "Health care" }], {
    "us-pce-healthcare": index,
    "us-pce-spend-healthcare": { meta: { unit: "usd" }, history: [{ date: "2026-09-01", value: 30 }] },
    "us-pce-spend-total": { meta: { unit: "usd" }, history: [{ date: "2026-09-01", value: 100 }] },
  }, "2026-09", "mom", false)[0];
  near(row.threeMonthSaar, saar);
  assert.equal(row.threeMonthEffect, null);
});
