import assert from "node:assert/strict";
import test from "node:test";
import { createEaMarketRefresh } from "./ea-market-refresh";

test("market polling backfills missing history and refreshes without a release-calendar event", async () => {
  const calls: Array<{ mode: string; metricIds: string[] }> = [];
  const refresh = createEaMarketRefresh({
    missingHistory: async () => ["ea-inflation-comp-1y"],
    ingest: async (mode, options) => {
      calls.push({ mode, metricIds: options.metricIds });
      return { failures: [] };
    },
  });
  await refresh(new Date("2026-10-30T12:00:00Z"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].mode, "backfill");
  assert.deepEqual(calls[0].metricIds, ["ea-inflation-comp-1y"]);
  assert.equal(calls[1].mode, "refresh");
  assert.equal(calls[1].metricIds.length, 5);
  await refresh(new Date("2026-10-30T12:01:00Z"));
  assert.equal(calls.length, 2, "must throttle ordinary release-worker ticks");
  await refresh(new Date("2026-10-30T12:15:00Z"));
  assert.equal(calls.length, 3);
});

test("a failed backfill is retried, and concurrent ticks do not duplicate requests", async () => {
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const refresh = createEaMarketRefresh({
    missingHistory: async () => ["ea-inflation-comp-5y"],
    ingest: async () => {
      calls++;
      if (calls === 1) await pending;
      return { failures: calls === 1 ? [{ metricId: "ea-inflation-comp-5y", error: "offline" }] : [] };
    },
  });
  const first = refresh(new Date("2026-10-30T12:00:00Z"));
  await Promise.resolve();
  await refresh(new Date("2026-10-30T12:00:01Z"));
  assert.equal(calls, 1);
  finish();
  await assert.rejects(first, /offline/);
  await refresh(new Date("2026-10-30T12:15:00Z"));
  assert.equal(calls, 4, "a failed backfill must not block live updates; retry missing history at the next interval");
});

test("market polling skips weekends in the euro-area timezone", async () => {
  let calls = 0;
  const refresh = createEaMarketRefresh({
    missingHistory: async () => [],
    ingest: async () => { calls++; return { failures: [] }; },
  });
  await refresh(new Date("2026-10-30T23:30:00Z")); // Saturday in Brussels
  assert.equal(calls, 0);
  await refresh(new Date("2026-11-02T08:00:00Z"));
  assert.equal(calls, 1);
});
