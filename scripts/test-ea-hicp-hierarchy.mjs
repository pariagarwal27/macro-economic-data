import assert from "node:assert/strict";
import test from "node:test";
import { DASHBOARD } from "../src/components/macro-ui-hierarchy.ts";

test("Euro Area prices keep Services in front and nest the other main HICP groups", () => {
  const frontCards = DASHBOARD.EA.prices;

  assert.deepEqual(
    frontCards.map(({ id }) => id),
    ["ea-hicp-card", "ea-core-card", "ea-services-card"],
  );

  const headline = frontCards.find(({ id }) => id === "ea-hicp-card");
  assert.ok(headline);
  assert.deepEqual(
    headline.components?.map(({ label }) => label),
    ["Food, Alcohol & Tobacco", "Energy", "Non-Energy Industrial Goods"],
  );

  const services = frontCards.find(({ id }) => id === "ea-services-card");
  assert.equal(services?.metricId, "ea-services-hicp-yoy");
});
