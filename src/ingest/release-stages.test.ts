import assert from "node:assert/strict";
import test from "node:test";
import { eurostatExpectedPublicationPeriod, eurostatScheduledReleaseStage } from "./release-stages";
import { eurostatGdpScheduleFallbacks, missingEurostatGdpScheduleFallbacks } from "./eurostat-release-schedules";
import { fetchEurostatPreset } from "./eurostat";

test("Eurostat GDP schedules distinguish flash, regular, and later revised releases", () => {
  assert.equal(eurostatScheduledReleaseStage("ea-gdp-qoq", "Preliminary flash estimate GDP - EU and euro area, Q3/2026"), "flash");
  assert.equal(eurostatScheduledReleaseStage("ea-gdp-yoy", "Flash estimate GDP and employment - EU and euro area"), "flash");
  assert.equal(eurostatScheduledReleaseStage("ea-gdp-qoq", "GDP main aggregates and employment, Q3/2026"), "final");
  assert.equal(eurostatScheduledReleaseStage("ea-gdp-qoq", "GDP main aggregates and employment - update, Q3/2026"), "revised");
});

test("Eurostat HICP flash and final calendar titles are staged while unrelated releases are not", () => {
  assert.equal(eurostatScheduledReleaseStage("ea-hicp-yoy", "Flash estimate inflation euro area, October 2026"), "flash");
  assert.equal(eurostatScheduledReleaseStage("ea-core-hicp-yoy", "Inflation (HICP), October 2026"), "final");
  assert.equal(eurostatScheduledReleaseStage("ea-unemployment", "Unemployment, September 2026"), undefined);
  assert.equal(eurostatScheduledReleaseStage("ea-employment-qoq", "Flash estimate GDP and employment - EU and euro area"), undefined);
});

test("scheduled Eurostat releases reject an API response for an older reference period", () => {
  assert.equal(eurostatExpectedPublicationPeriod("ea-gdp-qoq", "2026-10-30"), "2026-07-01");
  assert.equal(eurostatExpectedPublicationPeriod("ea-gdp-yoy", "2026-12-07T11:00:00+01:00"), "2026-07-01");
  assert.equal(eurostatExpectedPublicationPeriod("ea-hicp-yoy", "2026-11-04"), "2026-10-01");
  assert.equal(eurostatExpectedPublicationPeriod("ea-hicp-mom", "2027-01-15"), "2026-12-01");
  assert.equal(eurostatExpectedPublicationPeriod("ea-unemployment", "2026-10-30"), undefined);
});

test("the official Q3 GDP release dates remain available to the fetcher and calendar if a refresh misses them", () => {
  const schedules = eurostatGdpScheduleFallbacks();
  assert.deepEqual([...new Set(schedules.map(row => row.nextReleaseDate))], ["2026-10-30", "2026-11-13", "2026-12-07"]);
  assert.equal(schedules.length, 6);
  assert.ok(schedules.every(row => row.nextReleaseAt?.endsWith("T11:00:00+01:00")));
  assert.ok(schedules.every(row => row.officialSource?.includes("eurostat")));
  const fallbacks = missingEurostatGdpScheduleFallbacks([{ metricId: "ea-gdp-qoq", nextReleaseDate: "2026-11-13" }]);
  assert.ok(!fallbacks.some(row => row.metricId === "ea-gdp-qoq" && row.nextReleaseDate === "2026-11-13"));
  assert.ok(fallbacks.some(row => row.metricId === "ea-gdp-qoq" && row.nextReleaseDate === "2026-10-30"));
});

test("Eurostat GDP observations are downloaded and parsed as real JSON-stat observations", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async input => {
    requestedUrl = String(input);
    return Response.json({
      id: ["time"], size: [1],
      dimension: { time: { category: { index: { "2026-Q3": 0 } } } },
      value: { "0": 0.2 }, status: { "0": "e" },
    });
  };
  try {
    const points = await fetchEurostatPreset("ea_gdp_real");
    const url = new URL(requestedUrl);
    assert.ok(url.pathname.endsWith("/namq_10_gdp"));
    assert.equal(url.searchParams.get("geo"), "EA21");
    assert.equal(url.searchParams.get("na_item"), "B1GQ");
    assert.deepEqual(points, [{ date: "2026-07-01", value: 0.2, releaseStage: "estimate" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
