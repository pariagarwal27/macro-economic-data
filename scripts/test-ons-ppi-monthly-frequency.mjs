import assert from "node:assert/strict";
import { parseOnsCsv } from "../src/ingest/ons-csv.ts";

const points = parseOnsCsv([
  "Date,GB7S",
  "2024,100.0",
  "2024 Q1,100.1",
  "2024 JAN,99.8",
  "2024 FEB,100.0",
  "2024 APR,100.3",
].join("\n"), true);
assert.deepEqual(points.map(({ date }) => date), ["2024-01-01", "2024-02-01", "2024-04-01"]);
assert.deepEqual(points.map(({ value }) => value), [99.8, 100.0, 100.3]);

console.log("ONS PPI ingestion keeps monthly rows and excludes annual/quarterly values.");
