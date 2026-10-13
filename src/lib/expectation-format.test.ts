import assert from "node:assert/strict";
import test from "node:test";

test("formats expectation percentages precisely enough to distinguish nearby releases", async () => {
  const { formatExpectationValue } = await import("./expectation-format");
  const payload = { meta: { unit: "percent" } } as Parameters<typeof formatExpectationValue>[0];

  assert.equal(formatExpectationValue(payload, 2.64), "2.64%");
  assert.equal(formatExpectationValue(payload, 2.61), "2.61%");
  assert.equal(formatExpectationValue(payload, 2.6), "2.60%");
});
