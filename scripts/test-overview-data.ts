import assert from "node:assert/strict";
import { buildOverviewSeries, buildOverviewInflationSeries, overviewMetricIds, overviewWindow, latestOverviewReading, latestOverviewMovement, latestOverviewInflationMovement, overviewAxisTicks, type OverviewPayload } from "../src/lib/overview-data";
import { releaseTapeWindow } from "../src/lib/calendar-tape";

const now = new Date("2026-10-09T12:00:00Z");
assert.equal(overviewWindow(now).monthCount, 10);
assert.equal(overviewWindow(new Date("2026-11-01T02:00:00Z")).monthCount, 10, "the month boundary follows the user's Pacific timezone");
assert.equal(overviewWindow(new Date("2027-03-01T12:00:00Z")).monthCount, 3, "the rolling overview window follows the current Pacific month");

const payload: OverviewPayload = {
  "us-cpi": { history: [
    {date:"2025-12-01",value:9}, {date:"2026-01-01",value:3},
    {date:"2026-03-01",value:0}, {date:"2026-10-01",value:2.8},
    {date:"2026-11-01",value:7}, {date:"2026-04-01",value:Number.NaN},
  ] },
  "uk-cpi-yoy": {history:[{date:"2026-02-01",value:2.5}]},
  "us-gdp-real": {history:[{date:"2026-01-01",value:4},{date:"2026-04-01",value:-2},{date:"2026-10-01",value:5}]},
  "uk-gdp-qoq": {history:[{date:"2026 Q1",value:0.4}]},
  "ea-gdp-qoq": {history:[{date:"2026-03-31",value:0.3}]},
};
const inflation = buildOverviewSeries(payload, "inflation", now);
assert.equal(inflation.length, 13, "the rolling 12-month window includes both endpoint months");
assert.equal(inflation[0].period, "2025-10");
assert.equal(inflation.at(-1)?.period, "2026-10");
assert.equal(inflation.find(point => point.period === "2026-01")?.US, 3);
assert.equal(inflation.find(point => point.period === "2026-02")?.US, null, "missing observations are not zero-filled or forward-filled");
assert.equal(inflation.find(point => point.period === "2026-03")?.US, 0, "a published zero is retained");
assert.equal(inflation.find(point => point.period === "2026-04")?.US, null, "non-finite readings are omitted");
assert.equal(inflation.find(point => point.period === "2026-02")?.UK, 2.5);
assert.ok(inflation.every(row=>row.EA===null));
assert.deepEqual(latestOverviewReading(payload, "US", "inflation", now), {date:"2026-10-01",value:2.8});
assert.equal(latestOverviewReading({}, "EA", "unemployment", now), null);
const indexPayload: OverviewPayload = { "us-cpi": {meta:{unit:"index"},history:[{date:"2025-01-01",value:300},{date:"2026-01-01",value:309},{date:"2026-02-01",value:310}]}};
const indexSeries = buildOverviewSeries(indexPayload,"inflation",now);
assert.ok(Math.abs(indexSeries.find(point => point.period === "2026-01")!.US! - 3) < 1e-10);
assert.equal(indexSeries.find(point => point.period === "2026-02"),undefined,"index levels without an exact prior-year observation are not plotted");

const gdp = buildOverviewSeries(payload, "gdp", now);
assert.equal(gdp.length, 5, "last five quarter endpoints span a rolling four-quarter window");
assert.equal(gdp[3].label, "Q1 2026");
assert.ok(Math.abs(gdp[3].US! - (Math.pow(1.04,0.25)-1)*100) < 1e-10);
assert.ok(Math.abs(gdp[4].US! - (Math.pow(0.98,0.25)-1)*100) < 1e-10);
assert.equal(gdp[3].UK, 0.4, "published UK QoQ rates are unchanged");
assert.equal(gdp[3].EA, 0.3, "quarter-end and quarter-start periods align in the same quarter");
assert.equal(gdp[2].US, null);
assert.equal(gdp.find(point => point.label === "Q4 2026"), undefined, "an incomplete current quarter is excluded");
assert.equal(payload["us-gdp-real"]?.history[0].value, 4, "source observations are never mutated");

const axisData = [
  { date: "2026-01-01", period: "Jan", label: "Jan", US: 2.4, UK: 3, EA: 1.7 },
  { date: "2026-02-01", period: "Feb", label: "Feb", US: 4.2, UK: 3.1, EA: null },
];
const inflationTicks = overviewAxisTicks(axisData, "inflation");
assert.ok(inflationTicks[0] >= 1.5 && inflationTicks[0] < 2.4, "inflation scale starts near its own minimum, not zero");
assert.ok(inflationTicks.at(-1)! > 4.2 && inflationTicks.at(-1)! < 8, "inflation scale has modest headroom");
const unemploymentTicks = overviewAxisTicks([{ ...axisData[0], US: 4.1, UK: 5, EA: 6.4 }], "unemployment");
assert.ok(unemploymentTicks[0] >= 4 && unemploymentTicks[0] < 4.1, "unemployment scale is independent from inflation");
const gdpTicks = overviewAxisTicks([{ ...axisData[0], US: 0.6, UK: 0.5, EA: -0.1 }], "gdp");
assert.ok(gdpTicks[0] <= -0.1 && gdpTicks.at(-1)! > 0.6, "GDP scale includes all values and headroom");
assert.ok(gdpTicks.includes(0), "GDP scale retains the zero baseline");

const wagePayload: OverviewPayload = {
  "us-cpi": { history: [{date:"2025-10-01",value:100},{date:"2026-10-01",value:102.8}] , meta:{unit:"index"} },
  "uk-cpi-yoy": { history: [{date:"2026-10-01",value:2.9}] },
  "ea-hicp-yoy": { history: [{date:"2026-10-01",value:2.6}] },
  "us-cpi-core": { history: [{date:"2025-10-01",value:100},{date:"2026-08-01",value:102.5},{date:"2026-09-01",value:102.8},{date:"2026-10-01",value:103.1}], meta:{unit:"index"} },
  "uk-core-cpi-yoy": { history: [{date:"2026-10-01",value:3.2}] },
  "ea-core-hicp-yoy": { history: [{date:"2026-10-01",value:2.7}] },
  "us-ahe": { history: [{date:"2025-10-01",value:3.5},{date:"2025-11-01",value:3.6},{date:"2026-10-01",value:3.8}] },
  "uk-awe-regular-yoy": { history: [{date:"2025-10-01",value:5.1},{date:"2026-10-01",value:4.7}] },
  "ea-wage-growth": { history: [{date:"2025-10-01",value:4.2},{date:"2026-01-01",value:4.0},{date:"2026-04-01",value:3.9}], meta:{frequency:"quarterly"} },
  "us-ahe-mom": { history: [{date:"2026-09-01",value:0.1},{date:"2026-10-01",value:0.2}] },
  "uk-awe-regular-mom": { history: [{date:"2026-10-01",value:0.3}] },
  "ea-wage-growth-qoq": { history: [{date:"2026-01-01",value:0.9},{date:"2026-04-01",value:0.8}], meta:{frequency:"quarterly"} },
  "us-cpi-mom": { history: [{date:"2026-09-01",value:0.1},{date:"2026-10-01",value:0.2}] },
  "uk-cpi-mom": { history: [{date:"2026-10-01",value:0.1}] },
  "ea-hicp-mom": { history: [{date:"2026-10-01",value:0.3}] },
  "uk-core-cpi-mom": { history: [{date:"2026-10-01",value:0.2}] },
  "ea-core-hicp-mom": { history: [{date:"2026-10-01",value:0.2}] },
  "us-unemployment": { history: [{date:"2025-10-01",value:4.1},{date:"2026-08-01",value:4.1},{date:"2026-09-01",value:4.2},{date:"2026-10-01",value:4.3}] },
  "uk-unemployment": { history: [{date:"2025-10-01",value:4.4},{date:"2026-09-01",value:4.8},{date:"2026-10-01",value:4.9}] },
  "ea-unemployment": { history: [{date:"2025-10-01",value:6.3},{date:"2026-09-01",value:6.4},{date:"2026-10-01",value:6.4}] },
};
const wage = buildOverviewSeries(wagePayload, "wage", now);
assert.equal(wage.at(-1)?.period, "2026-10");
assert.equal(wage.at(-1)?.US, 3.8);
assert.equal(wage.at(-1)?.UK, 4.7);
assert.equal(wage.find(point => point.period === "2026-06")?.EA, 3.9, "quarter-start EA observations align to quarter-end months for plotting");
const inflationYoy = buildOverviewInflationSeries(wagePayload, "yoy", now);
const inflationMom = buildOverviewInflationSeries(wagePayload, "mom", now);
assert.ok(Math.abs(inflationYoy.at(-1)!.usHeadline as number - 2.8) < 1e-10, "headline US CPI YoY is derived from its index history");
assert.ok(Math.abs(inflationYoy.at(-1)!.usCore as number - 3.1) < 1e-10, "US core YoY is derived from the existing core CPI index");
assert.equal(inflationYoy.at(-1)?.eaCore, 2.7, "the Euro Area core HICP series is included");
assert.equal(inflationMom.at(-1)?.usHeadline, 0.2, "the MoM switch uses the published monthly headline rate");
assert.ok(Math.abs(inflationMom.at(-1)!.usCore as number - ((103.1 / 102.8 - 1) * 100)) < 1e-10, "US core MoM is derived from the existing core CPI index");
assert.equal(inflationMom.at(-1)?.ukCore, 0.2, "the MoM switch includes UK core CPI");
assert.ok(overviewMetricIds().includes("ea-core-hicp-mom"), "the overview API requests core HICP monthly history");
assert.ok(overviewMetricIds().includes("us-cpi-core"), "the overview API requests the existing US core CPI index");
const usInflationMovement = latestOverviewMovement(wagePayload, "inflation", "US", now)!;
assert.ok(Math.abs(usInflationMovement.primary - 2.8) < 1e-10);
assert.deepEqual({ secondary: usInflationMovement.secondary, primaryLabel: usInflationMovement.primaryLabel, secondaryLabel: usInflationMovement.secondaryLabel, date: usInflationMovement.date }, { secondary: 0.2, primaryLabel: "YoY", secondaryLabel: "MoM", date: "2026-10-01" });
assert.ok(Math.abs(usInflationMovement.secondaryChange! - 0.1) < 1e-10, "the MoM reading has its own change cue");
const usCoreInflationMovement = latestOverviewInflationMovement(wagePayload, "US", "core", now)!;
assert.ok(Math.abs(usCoreInflationMovement.primary - 3.1) < 1e-10, "US core YoY is derived from the index");
assert.ok(Math.abs(usCoreInflationMovement.secondary! - ((103.1 / 102.8 - 1) * 100)) < 1e-10, "US core MoM is derived from the index");
assert.ok(Math.abs(usCoreInflationMovement.secondaryChange! - (((103.1 / 102.8 - 1) - (102.8 / 102.5 - 1)) * 100)) < 1e-10, "US core MoM change compares monthly rates");
const ukCoreInflationMovement = latestOverviewInflationMovement(wagePayload, "UK", "core", now)!;
assert.equal(ukCoreInflationMovement.primary, 3.2);
assert.equal(ukCoreInflationMovement.secondary, 0.2);
const eaCoreInflationMovement = latestOverviewInflationMovement(wagePayload, "EA", "core", now)!;
assert.equal(eaCoreInflationMovement.primary, 2.7);
assert.equal(eaCoreInflationMovement.secondary, 0.2);
const eaWageMovement = latestOverviewMovement(wagePayload, "wage", "EA", now)!;
assert.equal(eaWageMovement.primary, 3.9);
assert.equal(eaWageMovement.secondary, 0.8);
assert.ok(Math.abs(eaWageMovement.primaryChange! + 0.1) < 1e-10);
assert.ok(Math.abs(eaWageMovement.secondaryChange! + 0.1) < 1e-10, "the quarterly auxiliary reading has its own change cue");
assert.equal(eaWageMovement.primaryChangeLabel, "vs prior quarter");
const usUnemploymentMovement = latestOverviewMovement(wagePayload, "unemployment", "US", now)!;
assert.ok(Math.abs(usUnemploymentMovement.primary - 4.3) < 1e-10);
assert.ok(Math.abs(usUnemploymentMovement.secondary! - 0.1) < 1e-10);
assert.ok(Math.abs(usUnemploymentMovement.yearlyChange! - 0.2) < 1e-10);
assert.equal(usUnemploymentMovement.secondaryLabel, "MoM Δ (pp)");
assert.equal(usUnemploymentMovement.primaryChangeLabel, "vs prior month");
assert.ok(Math.abs(usUnemploymentMovement.secondaryChange!) < 1e-10, "the MoM rate movement compares with the previous monthly movement");

assert.deepEqual(releaseTapeWindow(now,7,{pastOnly:true}),{start:new Date("2026-10-02T12:00:00Z"),end:now});
assert.deepEqual(releaseTapeWindow(now,7,{forwardOnly:true}),{start:now,end:new Date("2026-10-16T12:00:00Z")});
assert.deepEqual(releaseTapeWindow(now,1,{forwardOnly:false}),{start:new Date("2026-10-09T00:00:00Z"),end:new Date("2026-10-10T00:00:00Z")});
console.log("PASS overview: rolling 12-month trends, Pacific month boundaries, chart gaps, comparable GDP rates, wage comparisons, and summary movements");
