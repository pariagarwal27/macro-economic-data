import test from "node:test";
import assert from "node:assert/strict";
import { stableDetailNodes } from "./detail-drawer-nodes.ts";

test("detail drawer gets the same empty node list when a metric has no components", () => {
  assert.strictEqual(stableDetailNodes(undefined), stableDetailNodes(undefined));
});

test("detail drawer preserves the supplied component list", () => {
  const nodes = [{ id: "core", label: "Core" }];
  assert.strictEqual(stableDetailNodes(nodes), nodes);
});
