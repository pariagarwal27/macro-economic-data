import assert from "node:assert/strict";
import test from "node:test";

test("expectation chart axes use fine steps for tightly grouped readings", async () => {
  const { getExpectationAxisTicks } = await import("./chart-axis");

  const ticks = getExpectationAxisTicks([2.57, 2.61, 2.64, 2.68]);
  assert.ok(ticks[0]! < 2.57 && ticks.at(-1)! > 2.68);
  assert.ok(ticks[1]! - ticks[0]! <= 0.025);
  assert.ok(ticks.at(-1)! - ticks[0]! < 0.16);
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
