import assert from "node:assert/strict";
import {
  formatOfficialComponentWeight,
  getOfficialComponentWeight,
} from "../src/lib/official-component-weights.ts";

assert.equal(getOfficialComponentWeight("us-cpi-food")?.value, 13.698);
assert.equal(getOfficialComponentWeight("uk-food-cpi-yoy")?.value, 10.9606);
assert.equal(getOfficialComponentWeight("uk-food-cpih-yoy")?.value, 8.658);
assert.equal(getOfficialComponentWeight("ea-food-hicp-yoy")?.value, 18.935);
assert.equal(getOfficialComponentWeight("ea-services-hicp-yoy")?.value, 46.823);
assert.equal(getOfficialComponentWeight("us-unemployment")?.value, undefined);
assert.equal(getOfficialComponentWeight("unknown-metric"), null);
assert.equal(formatOfficialComponentWeight(10.9606), "10.96%");
assert.equal(formatOfficialComponentWeight(13.698), "13.7%");
assert.equal(formatOfficialComponentWeight(100), "100%");
console.log("Official component weight checks passed.");
