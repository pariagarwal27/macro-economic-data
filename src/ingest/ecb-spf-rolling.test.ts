import assert from "node:assert/strict";
import test from "node:test";
import { parseSpfRollingWages } from "./ecb-spf-rolling";
import { spfSurveyLabel } from "../lib/spf-horizons";

test("wage rolling horizons follow each survey's target year and exclude long-term targets from two-year forecasts", () => {
  const csv = ["KEY,TIME_PERIOD,OBS_VALUE",
    "SPF.Q.U2.ASSU.LAB.2020.Q.AVG,2020-Q1,2.24",
    "SPF.Q.U2.ASSU.LAB.2021.Q.AVG,2020-Q1,2.34",
    "SPF.Q.U2.ASSU.LAB.2022.Q.AVG,2020-Q1,2.44",
    "SPF.Q.U2.ASSU.LAB.2025.Q.AVG,2020-Q3,2.54",
    "SPF.Q.U2.ASSU.LAB.LT.Q.AVG,2020-Q3,2.54",
    "SPF.Q.U2.ASSU.LAB.2020.Q.AVG,2020-Q2,",
  ].join("\n");
  const data = parseSpfRollingWages(csv);
  assert.deepEqual(data.SPF_WAGE_ROLLING_CURRENT, [{ date: "2020-01-01", value: 2.2 }]);
  assert.deepEqual(data.SPF_WAGE_ROLLING_NEXT, [{ date: "2020-01-01", value: 2.3 }]);
  assert.deepEqual(data.SPF_WAGE_ROLLING_TWO_YEARS, [{ date: "2020-01-01", value: 2.4 }]);
  assert.deepEqual(data.SPF_WAGE_ROLLING_LT, [{ date: "2020-07-01", value: 2.5 }]);
});

test("SPF tooltip identifies survey quarter and actual target year for rolling horizons", () => {
  assert.equal(spfSurveyLabel("2020-01", 0), "Survey Q1 2020 · forecast for 2020");
  assert.equal(spfSurveyLabel("2020-01", 2), "Survey Q1 2020 · forecast for 2022");
  assert.equal(spfSurveyLabel("2020-04", "long-term"), "Survey Q2 2020 · forecast for 2024");
  assert.equal(spfSurveyLabel("2020-07", "long-term"), "Survey Q3 2020 · forecast for 2025");
});
