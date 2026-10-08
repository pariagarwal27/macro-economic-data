import assert from "node:assert/strict";
import { applyTransform } from "../src/ingest/transforms";

const points = [
  { date: "2026-04-01", value: 710 },
  { date: "2026-05-01", value: 711 },
  { date: "2026-06-01", value: 706 },
  { date: "2026-07-01", value: 702 },
];

assert.deepEqual(
  applyTransform(points, "diff_3m").at(-1),
  { date: "2026-07-01", value: -8, rawValue: 702 },
  "ONS vacancy change compares the latest rolling-quarter estimate with the non-overlapping three-month period",
);
