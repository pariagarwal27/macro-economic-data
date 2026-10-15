import assert from "node:assert/strict";
import {
  getUnderlyingInflationPublishedRates,
  normalizeUnderlyingInflationDetailSpec,
} from "./underlying-inflation-detail.ts";

const sticky = normalizeUnderlyingInflationDetailSpec({
  id: "us-sticky-cpi",
  metricId: "us-sticky-cpi",
  title: "Sticky CPI",
});
assert.equal(sticky.yoyMetricId, "us-sticky-cpi");
assert.equal(sticky.momMetricId, "us-sticky-cpi-mom");

const coreStickyMom = normalizeUnderlyingInflationDetailSpec({
  id: "calendar-row",
  metricId: "us-core-sticky-cpi-mom",
});
assert.equal(coreStickyMom.metricId, "us-core-sticky-cpi");
assert.equal(coreStickyMom.yoyMetricId, "us-core-sticky-cpi");
assert.equal(coreStickyMom.momMetricId, "us-core-sticky-cpi-mom");

const stickyRates = getUnderlyingInflationPublishedRates(sticky, {
  "us-sticky-cpi": [
    { date: "2026-08-01", value: 3.0 },
    { date: "2026-09-01", value: 2.8 },
  ],
  "us-sticky-cpi-mom": [
    { date: "2026-08-01", value: 0.25 },
    { date: "2026-09-01", value: 0.28 },
  ],
});
assert.deepEqual(stickyRates, { yoy: 2.8, mom: 0.28 });

const ordinary = { id: "us-cpi-card", metricId: "us-cpi", yoyMetricId: "us-cpi-yoy" };
assert.equal(normalizeUnderlyingInflationDetailSpec(ordinary), ordinary);

console.log("underlying inflation detail metric routing tests passed");
