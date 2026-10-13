import test from "node:test";
import assert from "node:assert/strict";
import { retainHistoryRangeIdentity } from "./history-range.ts";

test("unchanged chart ranges preserve state identity", () => {
  const current = { from: 2025, to: 2026 };
  assert.strictEqual(retainHistoryRangeIdentity(current, { from: 2025, to: 2026 }), current);
});

test("changed chart ranges replace state", () => {
  const current = { from: 2025, to: 2026 };
  const next = { from: 2023, to: 2026 };
  assert.strictEqual(retainHistoryRangeIdentity(current, next), next);
});
