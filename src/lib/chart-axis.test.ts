import assert from "node:assert/strict";
import test from "node:test";
import { getNiceTicks, getNiceTickDomain, getPairedAxisTicks, getTickPrecision } from "./chart-axis";
import { overviewAxisDomain } from "./overview-data";

test("small movements at a large level use most of the vertical axis", () => {
  const values = [100.001, 100.002, 100.003];
  const ticks = getNiceTicks(values);
  const [min, max] = getNiceTickDomain(ticks);
  assert.ok(min < 100.001 && max > 100.003, "leave room around both extremes");
  assert.ok(max - min < 0.004, "fixed minimum steps must not flatten small changes");
  assert.equal(new Set(ticks.map(value => value.toFixed(getTickPrecision(ticks)))).size, ticks.length);
});

test("a selected narrow window rescales independently of historical extremes", () => {
  const [min, max] = getNiceTickDomain(getNiceTicks([2.61, 2.62, 2.63], 7, 0.1));
  assert.ok(min < 2.61 && max > 2.63);
  assert.ok(max - min < 0.04);
});

test("paired inflation measures get independent scales for YoY and 3m/3m SAAR", () => {
  const { primaryTicks, secondaryTicks } = getPairedAxisTicks(
    [2.6, 2.8, 3.0, 3.2],
    [0.2, 0.5, 6.2, 8.1],
    7,
    0.05,
  );
  const [primaryMin, primaryMax] = getNiceTickDomain(primaryTicks);
  const [combinedMin, combinedMax] = getNiceTickDomain(getNiceTicks([2.6, 2.8, 3.0, 3.2, 0.2, 0.5, 6.2, 8.1], 7, 0.05));

  assert.ok(primaryMin < 2.6 && primaryMax > 3.2);
  assert.ok(getNiceTickDomain(secondaryTicks)[0] < 0.2 && getNiceTickDomain(secondaryTicks)[1] > 8.1);
  assert.ok(primaryMax - primaryMin < combinedMax - combinedMin);
});

test("overview domains never inset past observed endpoints", () => {
  const ticks = getNiceTicks([2, 3]);
  const [min, max] = overviewAxisDomain(ticks);
  assert.ok(min < 2 && max > 3);
});

test("empty, constant, signed and zero-baseline scales stay finite and cover all values", () => {
  assert.deepEqual(getNiceTicks([NaN, Infinity]), []);
  for (const values of [[0], [250000], [-1.2, -0.3, 0, 2.1], [0, 103, 105]]) {
    const ticks = getNiceTicks(values);
    const [min, max] = getNiceTickDomain(ticks);
    assert.ok(Number.isFinite(min) && Number.isFinite(max) && max > min);
    assert.ok(min <= Math.min(...values) && max >= Math.max(...values));
    assert.equal(new Set(ticks).size, ticks.length);
  }
});
