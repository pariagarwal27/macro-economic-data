import assert from "node:assert/strict";
import test from "node:test";
import { joltsVuRatio, joltsVuThreeMonthAverage } from "./jolts-vu-ratio";

test("JOLTS V/U ratio matches openings with unemployed persons on the same date", () => {
  const ratio = joltsVuRatio(
    [
      { date: "2026-07-01", value: 7100 },
      { date: "2026-08-01", value: 7300 },
      { date: "2026-09-01", value: 7200 },
    ],
    [
      { date: "2026-07-01", value: 7000 },
      { date: "2026-08-01", value: 7100 },
      { date: "2026-09-02", value: 7200 },
    ],
  );
  assert.deepEqual(ratio, [
    { date: "2026-07-01", value: 7100 / 7000 },
    { date: "2026-08-01", value: 7300 / 7100 },
  ]);
});

test("JOLTS V/U ratio skips missing or invalid denominators", () => {
  assert.deepEqual(
    joltsVuRatio(
      [{ date: "2026-07-01", value: 7100 }, { date: "2026-08-01", value: 7200 }],
      [{ date: "2026-07-01", value: 0 }],
    ),
    [],
  );
});

test("JOLTS V/U average uses three consecutive monthly ratios", () => {
  assert.deepEqual(
    joltsVuThreeMonthAverage([
      { date: "2026-06-01", value: 0.9 },
      { date: "2026-07-01", value: 1 },
      { date: "2026-08-01", value: 1.1 },
      { date: "2026-10-01", value: 1.3 },
    ]),
    [
      { date: "2026-06-01", value: null },
      { date: "2026-07-01", value: null },
      { date: "2026-08-01", value: 1 },
      { date: "2026-10-01", value: null },
    ],
  );
});
