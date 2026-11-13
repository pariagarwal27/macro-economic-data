import assert from "node:assert/strict";
import test from "node:test";
import { forecastNfpForRelease, nfpLiveModelProbe, predictNfpSurprise } from "./nfp-live-model";

test("runs the exported LightGBM preprocessing and trees to its Python reference prediction", () => {
  assert.ok(Math.abs(nfpLiveModelProbe() - 11.552796766442645) < 1e-8);
});

test("predicts from imputed inputs and reports how much live feature data is present", () => {
  const prediction = predictNfpSurprise({ previous_nfp: 162, current_consensus: 65 });
  assert.ok(Number.isFinite(prediction.prediction));
  assert.equal(prediction.featureCount, 2);
  assert.equal(prediction.featureTotal, 50);
});

test("uses only a same-date NFP consensus and matches released actuals by target month", () => {
  const snapshot = forecastNfpForRelease({
    targetMonth: "2026-11",
    releaseAt: "2026-12-04T13:30:00.000Z",
    asOf: "2026-11-27T13:30:00.000Z",
    releases: [
      { metricId: "us-nfp", periodDate: "2026-08-01", releasedAt: "2026-09-04T13:30:00.000Z", value: 162, expectedValue: 55 },
      { metricId: "us-nfp", periodDate: "2026-09-01", releasedAt: "2026-10-02T12:30:00.000Z", value: 29, expectedValue: 90 },
    ],
    calendarEvents: [
      { metricId: "us-adp-change", source: "investing", releasedAt: "2026-12-02T13:30:00.000Z", forecast: 74_000 },
      { metricId: "us-nfp", source: "investing", releasedAt: "2026-10-02T12:30:00.000Z", forecast: 90_000 },
      { metricId: "us-nfp", source: "investing", releasedAt: "2026-12-04T13:30:00.000Z", forecast: 65_000 },
    ],
  });

  assert.equal(snapshot.status, "experimental");
  assert.equal(snapshot.consensus, 65);
  assert.equal(snapshot.forecast, 65 + snapshot.predictedSurprise);
  assert.ok(Math.abs(snapshot.predictedSurprise - predictNfpSurprise(snapshot.inputs).prediction) < 1e-9);
  assert.equal(snapshot.inputs.adp_current_consensus, 74);
  assert.equal(snapshot.inputs.current_consensus, 65);
});

test("keeps the model signal when the target release does not yet have consensus", () => {
  const snapshot = forecastNfpForRelease({
    targetMonth: "2026-11",
    releaseAt: "2026-12-04T13:30:00.000Z",
    asOf: "2026-11-27T13:30:00.000Z",
    releases: [],
    calendarEvents: [],
  });

  assert.equal(snapshot.status, "awaiting-consensus");
  assert.equal(snapshot.forecast, null);
  assert.ok(Number.isFinite(snapshot.predictedSurprise));
});

test("excludes releases and consensus captured after the forecast time", () => {
  const snapshot = forecastNfpForRelease({
    targetMonth: "2026-11", releaseAt: "2026-12-04T13:30:00Z", asOf: "2026-12-03T23:00:00Z",
    releases: [{ metricId: "us-nfp", periodDate: "2026-10-01", releasedAt: "2026-12-04T00:00:00Z", value: 100 }],
    calendarEvents: [{ metricId: "us-nfp", source: "investing", releasedAt: "2026-12-04T13:30:00Z", importedAt: "2026-12-04T00:00:00Z", forecast: 100000 }],
  });
  assert.equal(snapshot.consensus, null);
  assert.equal(snapshot.inputs.previous_nfp, null);
});
