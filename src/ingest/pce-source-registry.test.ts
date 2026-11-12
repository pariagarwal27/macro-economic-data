import assert from "node:assert/strict";
import test from "node:test";
import { getSourceConfig, isUsCpiMetric } from "./source-registry";
test("PCE price rates and expenditure inputs route to BEA rather than BLS", () => {
  for (const id of ["us-pce-yoy", "us-pce-mom", "us-core-pce-yoy", "us-pce-spend-total", "us-pce-spend-healthcare"]) {
    assert.equal(isUsCpiMetric(id), false, id);
    assert.equal(getSourceConfig(id)?.source, "bea", id);
  }
});
