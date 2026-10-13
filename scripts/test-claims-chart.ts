import assert from "node:assert/strict";
import { mergeClaimsChartData } from "../src/lib/claims-chart";

const combined = mergeClaimsChartData(
  [
    { date: "2026-01-02", value: 205_000 },
    { date: "2026-01-09", value: 198_000 },
  ],
  [
    { date: "2026-01-02", value: 1_870_000 },
    { date: "2026-01-16", value: 1_840_000 },
  ],
);

assert.deepEqual(combined, [
  { date: "2026-01-02", initial: 205_000, continuing: 1_870_000 },
  { date: "2026-01-09", initial: 198_000, continuing: null },
  { date: "2026-01-16", initial: null, continuing: 1_840_000 },
], "claims series share a chronological date axis and preserve missing readings as gaps");
console.log("PASS claims chart: aligned weekly series with independent missing dates");
