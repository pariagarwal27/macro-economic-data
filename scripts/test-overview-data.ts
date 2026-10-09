import assert from "node:assert/strict";
import { buildOverviewSeries, overviewWindow, latestOverviewReading, type OverviewPayload } from "../src/lib/overview-data";
import { releaseTapeWindow } from "../src/lib/calendar-tape";

const now = new Date("2026-10-09T12:00:00Z");
assert.equal(overviewWindow(now).monthCount, 10);
assert.equal(overviewWindow(new Date("2026-11-01T02:00:00Z")).monthCount, 10, "the month boundary follows the user's Pacific timezone");
assert.equal(overviewWindow(new Date("2027-03-01T12:00:00Z")).monthCount, 12, "the fixed 2026 window never extends into 2027");

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
assert.equal(inflation.length, 10);
assert.equal(inflation[0].period, "2026-01");
assert.equal(inflation.at(-1)?.period, "2026-10");
assert.equal(inflation[0].US, 3);
assert.equal(inflation[1].US, null, "missing observations are not zero-filled or forward-filled");
assert.equal(inflation[2].US, 0, "a published zero is retained");
assert.equal(inflation[3].US, null, "non-finite readings are omitted");
assert.equal(inflation[1].UK, 2.5);
assert.ok(inflation.every(row=>row.EA===null));
assert.deepEqual(latestOverviewReading(payload, "US", "inflation", now), {date:"2026-10-01",value:2.8});
assert.equal(latestOverviewReading({}, "EA", "unemployment", now), null);
const indexPayload: OverviewPayload = { "us-cpi": {meta:{unit:"index"},history:[{date:"2025-01-01",value:300},{date:"2026-01-01",value:309},{date:"2026-02-01",value:310}]}};
assert.ok(Math.abs(buildOverviewSeries(indexPayload,"inflation",now)[0].US! - 3) < 1e-10);
assert.equal(buildOverviewSeries(indexPayload,"inflation",now)[1].US,null,"index levels require an exact prior-year observation");

const gdp = buildOverviewSeries(payload, "gdp", now);
assert.equal(gdp.length, 3, "only completed 2026 quarters fall within January through October");
assert.equal(gdp[0].label, "Q1 2026");
assert.ok(Math.abs(gdp[0].US! - (Math.pow(1.04,0.25)-1)*100) < 1e-10);
assert.ok(Math.abs(gdp[1].US! - (Math.pow(0.98,0.25)-1)*100) < 1e-10);
assert.equal(gdp[0].UK, 0.4, "published UK QoQ rates are unchanged");
assert.equal(gdp[0].EA, 0.3, "quarter-end and quarter-start periods align in the same quarter");
assert.equal(gdp[2].US, null);
assert.equal(payload["us-gdp-real"]?.history[0].value, 4, "source observations are never mutated");

assert.deepEqual(releaseTapeWindow(now,7,{pastOnly:true}),{start:new Date("2026-10-02T12:00:00Z"),end:now});
assert.deepEqual(releaseTapeWindow(now,7,{forwardOnly:true}),{start:now,end:new Date("2026-10-16T12:00:00Z")});
assert.deepEqual(releaseTapeWindow(now,1,{forwardOnly:false}),{start:new Date("2026-10-09T00:00:00Z"),end:new Date("2026-10-10T00:00:00Z")});
console.log("PASS overview: 2026 cutoff, Pacific month boundaries, chart gaps, comparable GDP rates, and calendar history window");
