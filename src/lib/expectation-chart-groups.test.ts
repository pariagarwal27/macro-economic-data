import assert from "node:assert/strict";
import test from "node:test";

test("model-based and UK professional expectations use the requested paired axes", async () => {
  const { EXPECTATION_CHART_GROUPS, EXPANDED_EXPECTATION_GROUP_IDS, MARKERLESS_EXPECTATION_GROUP_IDS } = await import("./expectation-chart-groups");

  assert.deepEqual(
    EXPECTATION_CHART_GROUPS["us-inflation-expectations-model"].map(group => ({
      ids: group.series.map(item => item.id),
      axes: group.series.map(item => item.axis),
    })),
    [
      { ids: ["us-cleveland-exp-inf-1y", "us-cleveland-exp-inf-3y"], axes: ["left", "right"] },
      { ids: ["us-cleveland-exp-inf-5y", "us-cleveland-exp-inf-10y"], axes: ["left", "right"] },
    ],
  );

  assert.deepEqual(
    EXPECTATION_CHART_GROUPS["uk-inflation-expectations-professional"].map(group => ({
      ids: group.series.map(item => item.id),
      axes: group.series.map(item => item.axis),
    })),
    [
      { ids: ["uk-maps-inflation-1y", "uk-maps-inflation-2y"], axes: ["left", "right"] },
      { ids: ["uk-maps-inflation-3y", "uk-maps-inflation-5y"], axes: ["left", "right"] },
    ],
  );

  assert.deepEqual(
    EXPECTATION_CHART_GROUPS["us-inflation-expectations-market"].map(group => ({
      ids: group.series.map(item => item.id),
      axes: group.series.map(item => item.axis),
    })),
    [
      { ids: ["us-breakeven-5y"], axes: [undefined] },
      { ids: ["us-5y5y-forward", "us-breakeven-10y"], axes: [undefined, undefined] },
    ],
  );

  assert.deepEqual(
    EXPECTATION_CHART_GROUPS["us-inflation-expectations-business"].map(group => ({
      ids: group.series.map(item => item.id),
      axes: group.series.map(item => item.axis),
    })),
    [
      { ids: ["us-atlanta-bie-1y"], axes: [undefined] },
      { ids: ["us-cleveland-sofie-1y", "us-cleveland-sofie-5y"], axes: ["left", "right"] },
    ],
  );

  assert.deepEqual([...EXPANDED_EXPECTATION_GROUP_IDS], [
    "us-inflation-expectations-market",
    "us-inflation-expectations-model",
  ]);

  assert.deepEqual([...MARKERLESS_EXPECTATION_GROUP_IDS], [
    "us-inflation-expectations-market",
  ]);
});
