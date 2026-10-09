import assert from "node:assert/strict";
import { resolveStudioSelection } from "../src/lib/chart-studio";

const us = [{id:"unemployment"},{id:"payrolls"},{id:"claims"}];
assert.equal(resolveStudioSelection(us,null)?.id,"unemployment");
assert.equal(resolveStudioSelection(us,"claims")?.id,"claims");
assert.equal(resolveStudioSelection([{id:"uk-unemployment"}],"claims")?.id,"uk-unemployment","changing country must not retain another country's selected indicator");
assert.equal(resolveStudioSelection([],"claims"),null);
assert.equal(us.length,3,"selection retains the full indicator list");
console.log("PASS studio selection: default, switching, country fallback, empty state");
