import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseOpenings, dashboardReleaseTarget, enqueueReleaseOpenings, mergeReleaseUpdates } from "./release-notifications";

const now = Date.parse("2026-10-28T13:30:10Z");
const release = (metricId: string, id: number, extra = {}) => ({ id, metricId, periodDate: "2026-09-01", releasedAt: "2026-10-28T13:30:00Z", stage: null, value: 3.2, ...extra });

test("rate aliases resolve to their own primary card before nested matches", () => {
  assert.equal(dashboardReleaseTarget("us-cpi-yoy")?.metricId, "us-cpi");
  assert.equal(dashboardReleaseTarget("us-core-cpi-mom")?.metricId, "us-cpi-core");
  assert.equal(dashboardReleaseTarget("us-core-pce-yoy")?.metricId, "us-core-pce");
  assert.equal(dashboardReleaseTarget("uk-cpi-mom")?.metricId, "uk-cpi-yoy");
  assert.equal(dashboardReleaseTarget("ea-core-hicp-mom")?.metricId, "ea-core-hicp-yoy");
});

test("component updates open their owning card, and unknown metrics are ignored", () => {
  assert.equal(dashboardReleaseTarget("us-cpi-shelter")?.metricId, "us-cpi");
  assert.equal(dashboardReleaseTarget("us-pce-healthcare")?.metricId, "us-pce");
  assert.equal(dashboardReleaseTarget("unknown"), null);
});

test("late component arrivals do not reopen a card; separate cards stay queued", () => {
  const seen = new Set<string>();
  const queue = enqueueReleaseOpenings([], buildReleaseOpenings([
    release("us-cpi-yoy", 1), release("us-cpi-mom", 2), release("us-cpi-shelter", 3),
    release("us-core-cpi-yoy", 4), release("us-pce-yoy", 5), release("uk-cpi-yoy", 6),
  ], now), seen);
  assert.deepEqual(queue.map(item => item.metricId), ["us-cpi", "us-cpi-core", "us-pce", "uk-cpi-yoy"]);
  assert.equal(enqueueReleaseOpenings(queue, buildReleaseOpenings([release("us-cpi-energy", 7)], now), seen).length, 4);
});

test("a new period or publication stage triggers even with an unchanged value", () => {
  const seen = new Set<string>();
  const queue = enqueueReleaseOpenings([], buildReleaseOpenings([
    release("ea-hicp-yoy", 1, {stage:"flash"}), release("ea-hicp-yoy", 2, {stage:"final"}),
    release("ea-hicp-yoy", 3, {periodDate:"2026-10-01"}),
  ], now), seen);
  assert.equal(queue.length, 3);
});

test("old backfills and future or invalid records do not open a card", () => {
  assert.equal(buildReleaseOpenings([
    release("us-cpi", 1, {releasedAt:"2026-09-28T13:30:00Z"}),
    release("us-cpi", 2, {releasedAt:"2026-10-29T13:30:00Z"}),
    release("us-cpi", 3, {releasedAt:"invalid"}),
  ], now).length, 0);
});

test("a committed release updates the visible history immediately without overwriting a newer vintage", () => {
  const existing = { "us-cpi-yoy": { history:[{date:"2026-08-01",value:3}], displayReleasedAt:"2026-09-01T13:30:00Z" } };
  const updated = mergeReleaseUpdates(existing, [release("us-cpi-yoy", 10)]);
  assert.deepEqual(updated["us-cpi-yoy"].history.at(-1), {date:"2026-09-01",value:3.2});
  const newer = { "us-cpi-yoy": { history:[{date:"2026-09-01",value:4}], displayReleasedAt:"2026-10-29T13:30:00Z" } };
  assert.equal(mergeReleaseUpdates(newer, [release("us-cpi-yoy", 10)]), newer);
});
