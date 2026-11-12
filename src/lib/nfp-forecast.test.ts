import assert from "node:assert/strict";
import test from "node:test";
import { forecastForNfpReleaseDate, matchNfpReleaseToObservation, selectUpcomingNfpForecast } from "./nfp-forecast";

test("selects the nearest future NFP consensus and converts jobs to thousands", () => {
  const forecast = selectUpcomingNfpForecast([
    { releasedAt: "2026-12-04T13:30:00.000Z", forecast: 72_000 },
    { releasedAt: "2026-11-06T13:30:00.000Z", forecast: 65_000 },
    { releasedAt: "2026-11-20T13:30:00.000Z", forecast: null },
  ], new Date("2026-11-12T12:00:00.000Z"));

  assert.deepEqual(forecast, {
    releasedAt: "2026-12-04T13:30:00.000Z",
    value: 72,
  });
});

test("returns no upcoming NFP forecast when only past or empty forecasts exist", () => {
  const forecast = selectUpcomingNfpForecast([
    { releasedAt: "2026-11-06T13:30:00.000Z", forecast: 65_000 },
    { releasedAt: "2026-12-04T13:30:00.000Z", forecast: null },
  ], new Date("2026-11-12T12:00:00.000Z"));

  assert.equal(forecast, null);
});

test("matches a released NFP consensus by scheduled release date", () => {
  const forecast = forecastForNfpReleaseDate("2026-11-06T13:30:00.000Z", [
    { releasedAt: "2026-10-02T12:30:00.000Z", forecast: 55_000 },
    { releasedAt: "2026-11-06T13:30:00.000Z", forecast: 65_000, importedAt: "2026-11-05T12:00:00.000Z" },
    { releasedAt: "2026-11-06T13:30:00.000Z", forecast: 67_000, importedAt: "2026-11-06T12:00:00.000Z" },
  ]);

  assert.equal(forecast, 67);
  assert.equal(forecastForNfpReleaseDate("2026-11-06T13:30:00.000Z", [
    { releasedAt: "2026-10-02T12:30:00.000Z", forecast: 55_000 },
  ]), null);
});

test("computes actual minus consensus only for the matching payroll month", () => {
  const release = matchNfpReleaseToObservation("2026-10-01", [
    { periodDate: "2026-09-01", value: 119, expectedValue: 55 },
    { periodDate: "2026-10-01", value: 75, expectedValue: 65 },
  ]);

  assert.deepEqual(release, { actual: 75, forecast: 65, difference: 10 });
  assert.equal(matchNfpReleaseToObservation("2026-10-01", [
    { periodDate: "2026-09-01", value: 119, expectedValue: 55 },
  ]), null);
});
