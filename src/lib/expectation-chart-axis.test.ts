import assert from "node:assert/strict";
import test from "node:test";

test("expectation chart axes use fine steps for tightly grouped readings", async () => {
  const { getExpectationAxisTicks } = await import("./chart-axis");

  assert.deepEqual(
    getExpectationAxisTicks([2.57, 2.61, 2.64, 2.68]),
    [2.55, 2.6, 2.65, 2.7],
  );
});

test("expectation chart axes keep wider ranges readable without clipping data", async () => {
  const { getExpectationAxisTicks, getNiceTickDomain } = await import("./chart-axis");
  const values = [2.3, 3.53];
  const ticks = getExpectationAxisTicks(values);
  const [min, max] = getNiceTickDomain(ticks);

  assert.ok(ticks.length > 5);
  assert.ok(min <= Math.min(...values));
  assert.ok(max >= Math.max(...values));
});
