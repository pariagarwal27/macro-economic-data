import { strict as assert } from "node:assert";
import { parseInvestingNumber, investingLondonTime, investingForecastToMetricValue } from "./investing-calendar";
import { mapInvestingEvent } from "@/catalog/investing-map";

assert.equal(parseInvestingNumber("189K"), 189000);
assert.equal(parseInvestingNumber("1.25M"), 1250000);
assert.equal(parseInvestingNumber("-0.3%"), -0.3);
assert.equal(parseInvestingNumber("—"), null);
assert.equal(parseInvestingNumber("not available"), null);
assert.equal(investingLondonTime("2026-11-12", "13:30"), "2026-11-12T13:30:00.000Z");
assert.equal(investingLondonTime("2026-07-12", "13:30"), "2026-07-12T12:30:00.000Z");
assert.equal(investingForecastToMetricValue("us-initial-claims", 189000), 189000);
assert.equal(investingForecastToMetricValue("us-nfp", 189000), 189);
assert.equal(mapInvestingEvent({ eventName: "Core PCE Price Index (YoY)", currency: "USD", country: "US" }), "us-core-pce-yoy");
assert.equal(mapInvestingEvent({ eventName: "PCE Price Index (MoM)", currency: "USD", country: "US" }), "us-pce-mom");
console.log("Investing calendar parsing checks passed");
