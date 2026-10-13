import assert from "node:assert/strict";
import test from "node:test";
import { DASHBOARD } from "./macro-ui-hierarchy.ts";

test("UK wage growth uses a matched regular-pay YoY and MoM pair", () => {
  const wageCard = DASHBOARD.UK.labour.find(({ id }) => id === "uk-wages-card");

  assert.equal(wageCard?.yoyMetricId, "uk-awe-regular-yoy");
  assert.equal(wageCard?.momMetricId, "uk-awe-regular-mom");
  assert.ok(wageCard?.components?.some(({ metricId, momMetricId }) => metricId === "uk-awe-regular-yoy" && momMetricId === "uk-awe-regular-mom"));
});

test("UK Economic Inactivity is nested under Employment while Growth cards stay visible", () => {
  const employment = DASHBOARD.UK.labour.find(({ id }) => id === "uk-employment-card");
  const inactivity = employment?.components?.find(({ label }) => label === "Economic Inactivity");

  assert.equal(inactivity?.metricId, "uk-inactivity-rate");
  assert.ok(inactivity?.children?.some(({ metricId }) => metricId === "uk-inactive-persons"));
  assert.ok(!DASHBOARD.UK.labour.some(({ id }) => id === "uk-inactivity-card"));
  assert.ok(DASHBOARD.UK.activity.some(({ id }) => id === "uk-retail-sales-card"));
  assert.ok(DASHBOARD.UK.activity.some(({ id }) => id === "uk-pmi-card"));
});
