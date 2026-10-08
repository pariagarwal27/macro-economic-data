import assert from "node:assert/strict";
import { claimsChartPoints, formatClaimsCount } from "../src/lib/claims-display.ts";

assert.equal(formatClaimsCount(1_701_000), "1,701,000");
assert.equal(formatClaimsCount(197_000), "197,000");
assert.equal(formatClaimsCount(null), "—");

assert.deepEqual(
  claimsChartPoints([
    { date: "2026-10-03T00:00:00Z", value: 197_000 },
    { date: "2026-09-26", value: 198_000 },
  ]),
  [
    { date: "2026-09-26", value: 198_000 },
    { date: "2026-10-03", value: 197_000 },
  ],
  "each claims chart should keep its own dated observations"
);

console.log("Claims values retain full counts and each series keeps its own weekly observations");
