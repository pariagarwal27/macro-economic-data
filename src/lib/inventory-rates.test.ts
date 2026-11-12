import assert from "node:assert/strict";
import test from "node:test";
import { inventoryRates } from "./inventory-rates";
import { formatEconomicLevel } from "./format";

test("quarterly inventory investment shows the recovery from negative bases in both KPI and chart calculations", () => {
  const history = [{ date: "2025-07-01", value: -45926 }, { date: "2026-04-01", value: -63438 }, { date: "2026-07-01", value: 20264 }];
  const result = inventoryRates(history);
  assert.ok(Math.abs(result.yoy! - 144.123160) < 0.00001);
  assert.ok(Math.abs(result.mom! - 131.943000) < 0.001);
  assert.equal(result.secondLabel, "QoQ");
  assert.equal(formatEconomicLevel(20264, "usd_millions"), "$20.3B");
});

test("inventory rates keep exact quarterly spacing and do not divide by a zero base", () => {
  assert.equal(inventoryRates([{ date: "2026-01-01", value: 100 }, { date: "2026-07-01", value: 120 }]).mom, null);
  assert.equal(inventoryRates([{ date: "2026-04-01", value: 0 }, { date: "2026-07-01", value: 120 }]).mom, null);
  assert.equal(inventoryRates([{ date: "2026-04-01", value: -100 }, { date: "2026-07-01", value: -150 }]).mom, -50);
});
