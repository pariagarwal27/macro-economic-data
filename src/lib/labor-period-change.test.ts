import assert from "node:assert/strict";
import test from "node:test";
import { laborChangeKpis, laborPublishedKpis, laborPeriodChanges, formatLaborChange, isLaborChangeMetric } from "./labor-period-change";
import { filterHistoryToTrailing12Months } from "./history-range";

test("payroll chart and headline both use the latest monthly job change", () => {
  const history = [{ date: "2026-07-01", value: 158900 }, { date: "2026-08-01", value: 159082 }, { date: "2026-09-01", value: 159051 }];
  assert.deepEqual(laborPeriodChanges(history), [{ date: "2026-08-01", value: 182 }, { date: "2026-09-01", value: -31 }]);
  assert.equal(laborChangeKpis("us-payrolls-level", history)?.leftValue, -31);
  assert.equal(formatLaborChange(-31, { id: "us-payrolls-level", unit: "thousands" }), "-31K");
});

test("ADP published changes stay direct, with latest and prior release values", () => {
  const history = [
    { date: "2026-07-01", value: 44 },
    { date: "2026-08-01", value: 36 },
    { date: "2026-09-01", value: 90 },
  ];
  assert.equal(isLaborChangeMetric("us-adp-change"), true);
  assert.equal(laborChangeKpis("us-adp-change", history)?.leftValue, 90);
  assert.deepEqual(
    [laborPublishedKpis("us-adp-change", history)?.leftValue, laborPublishedKpis("us-adp-change", history)?.rightValue],
    [90, 36],
  );
});

test("participation uses percentage-point differences rather than relative growth or levels", () => {
  const history = [{ date: "2026-08-01", value: 61.6 }, { date: "2026-09-01", value: 61.8 }];
  assert.equal(laborChangeKpis("us-participation", history)?.leftValue, 0.2);
  assert.equal(formatLaborChange(0.2, { id: "us-participation", unit: "percent" }), "+0.2 pp");
  assert.equal(formatLaborChange(0, { id: "us-participation", unit: "percent" }), "0.0 pp");
});

test("published readings retain actual latest and prior levels while cards and graphs show changes", () => {
  for (const id of ["us-payrolls-level", "us-participation", "us-jolts-openings", "uk-employment-level", "uk-vacancies", "uk-payrolled-employees-level"]) {
    const history = [{ date: "2026-08-01", value: 100 }, { date: "2026-09-01", value: 103 }];
    const published = laborPublishedKpis(id, history);
    assert.equal(published?.leftLabel, "Latest");
    assert.equal(published?.leftValue, 103);
    assert.equal(published?.rightLabel, "Prior");
    assert.equal(published?.rightValue, 100);
    assert.equal(published?.showRight, true);
    assert.equal(laborChangeKpis(id, history)?.leftValue, 3);
    assert.equal(laborPeriodChanges(history).at(-1)?.value, 3);
  }
});

test("job openings and the three requested UK metrics show signed count changes only", () => {
  for (const id of ["us-jolts-openings", "uk-employment-level", "uk-vacancies", "uk-payrolled-employees-level"]) {
    const kpis = laborChangeKpis(id, [{ date: "2026-08-01", value: 7300 }, { date: "2026-09-01", value: 7100 }]);
    assert.equal(kpis?.leftValue, -200);
    assert.equal(kpis?.showRight, false);
    assert.equal(formatLaborChange(-200, { id, unit: "thousands" }), "-200K");
  }
  assert.equal(formatLaborChange(100, { id: "uk-employment-level", unit: "thousands" }), "+100K");
  assert.equal(formatLaborChange(-11000, { id: "uk-vacancies", unit: "persons" }), "-11K");
});

test("missing prior months never become fake monthly changes or stale headline values", () => {
  const history = [{ date: "2026-01-01", value: 100 }, { date: "2026-02-01", value: 120 }, { date: "2026-04-01", value: 130 }];
  assert.deepEqual(laborPeriodChanges(history), [{ date: "2026-02-01", value: 20 }, { date: "2026-04-01", value: null }]);
  assert.equal(laborChangeKpis("us-jolts-openings", history)?.leftValue, null);
  assert.equal(laborChangeKpis("us-jolts-openings", [history[0]])?.leftValue, null);
  assert.equal(formatLaborChange(null, { id: "us-jolts-openings", unit: "thousands" }), "—");
});

test("derive before applying date windows so the first visible change retains its prior month", () => {
  const data = laborPeriodChanges([{ date: "2025-08-01", value: 100 }, { date: "2025-09-01", value: 105 }, { date: "2026-09-01", value: 120 }]);
  assert.equal(filterHistoryToTrailing12Months(data)[0]?.value, 5);
});

test("changes sort by period, handle year boundaries, and leave other metrics unchanged", () => {
  assert.deepEqual(laborPeriodChanges([{ date: "2026-01-01", value: 8 }, { date: "2025-12-01", value: 10 }]), [{ date: "2026-01-01", value: -2 }]);
  for (const id of ["us-unemployment", "uk-unemployment", "ea-job-vacancies", "us-ahe", "us-nfp"]) {
    assert.equal(isLaborChangeMetric(id), false);
    assert.equal(laborChangeKpis(id, []), null);
  }
});
