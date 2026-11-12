import assert from "node:assert/strict";
import test from "node:test";
import { readReleaseUpdates } from "./release-updates";

test("first connection establishes a cursor and does not replay past releases", async () => {
  const result = await readReleaseUpdates(null, async () => ({ rows: [{ id: 42 }] }));
  assert.deepEqual(result, { cursor: 42, updates: [], hasMore: false });
});

test("new committed releases advance the cursor including non-dashboard series", async () => {
  const result = await readReleaseUpdates(42, async query => {
    assert.deepEqual(query.args, [42]);
    return { rows: [
      { id: 43, metric_id: "us-cpi-yoy", period_date: "2026-09-01", released_at: "2026-10-28T13:30:00Z", value: 3.2, notes: null },
      { id: 44, metric_id: "unknown-series", period_date: "2026-09-01", released_at: "2026-10-28T13:30:00Z", value: 2, notes: null },
    ] };
  });
  assert.equal(result.cursor, 44);
  assert.deepEqual(result.updates.map(row => row.metricId), ["us-cpi-yoy"]);
});
