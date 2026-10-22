import assert from "node:assert/strict";
import { fetchEurostatPreset } from "../src/ingest/eurostat";
import { getActiveLiveMapping, getCloudSourceConfig, getSourceConfig } from "../src/ingest/source-registry";
import { getSeriesHistory, runIngest } from "../src/ingest/pipeline";
import { dispatchDueReleases, getDueReleaseCandidates } from "../src/ingest/release-dispatcher";
import { getEconomicCalendarRows } from "../src/lib/economic-calendar-db";

const pairs = [
  ["ea-food-hicp-yoy", "prc_hicp_minr_food"],
  ["ea-food-hicp-mom", "prc_hicp_mmor_food"],
  ["ea-energy-hicp-yoy", "prc_hicp_minr_nrg"],
  ["ea-energy-hicp-mom", "prc_hicp_mmor_nrg"],
  ["ea-goods-hicp-yoy", "prc_hicp_minr_igd_nnrg"],
  ["ea-goods-hicp-mom", "prc_hicp_mmor_igd_nnrg"],
] as const;

async function main() {
  const officialLatest = new Map<string, { date: string; value: number }>();

  for (const [metricId, seriesId] of pairs) {
    const local = getSourceConfig(metricId);
    const hosted = getCloudSourceConfig(metricId);
    assert.equal(local?.adapter, "pipeline", `${metricId} local path must use the release pipeline`);
    assert.equal(hosted?.adapter, "pipeline", `${metricId} hosted path must use the release pipeline`);
    assert.equal(getActiveLiveMapping(metricId, false)?.seriesId, seriesId, `${metricId} local mapping`);
    assert.equal(getActiveLiveMapping(metricId, true)?.seriesId, seriesId, `${metricId} hosted mapping`);

    const points = await fetchEurostatPreset(seriesId);
    const latest = points.at(-1);
    assert.ok(latest, `${seriesId} must return official observations`);
    officialLatest.set(metricId, latest);
    console.log(`Eurostat ${metricId}: ${latest.date} ${latest.value}%`);
  }

  const metricIds: string[] = pairs.map(([metricId]) => metricId);
  const calendarRows = await getEconomicCalendarRows();
  console.log("Euro Area HICP calendar rows:", JSON.stringify(
    calendarRows.filter(row => row.metricId.startsWith("ea-") && /hicp|inflation/i.test(`${row.metricId} ${row.metricName ?? ""}`)),
    null,
    2,
  ));
  const headlineRelease = calendarRows.find(row => row.metricId === "ea-hicp-yoy" && row.nextReleaseAt);
  assert.ok(headlineRelease?.nextReleaseAt, "headline HICP release time must be in the official calendar");
  const simulatedReleaseTime = new Date(Date.parse(headlineRelease.nextReleaseAt) + 1_000);
  const previewCandidates = await getDueReleaseCandidates(simulatedReleaseTime);
  const scheduledComponentIds = previewCandidates.map(candidate => candidate.metricId).filter(metricId => metricIds.includes(metricId)).sort();
  assert.deepEqual(scheduledComponentIds, [...metricIds].sort(), "all six component measures must be scheduled at the official HICP release time");
  console.log(`Scheduled release preview at ${simulatedReleaseTime.toISOString()}: ${scheduledComponentIds.join(", ")}`);

  const scheduled = await dispatchDueReleases({ metricIds, retryForMs: 0 });
  console.log("Scheduled release dispatcher:", JSON.stringify({
    checkedAt: scheduled.checkedAt,
    scheduledDue: scheduled.scheduledDue,
    eligible: scheduled.eligible,
    attempted: scheduled.attempted,
    results: scheduled.results,
  }, null, 2));

  const result = await runIngest("refresh", { metricIds });
  assert.equal(result.metricsProcessed, metricIds.length, "every component series must refresh");
  assert.equal(result.liveHits, metricIds.length, "every component must be fetched live from Eurostat");
  assert.equal(result.fredFallbacks, 0, "Eurostat metrics must not use fallback data");
  assert.deepEqual(result.failures, []);

  for (const [metricId] of pairs) {
    const expected = officialLatest.get(metricId)!;
    const saved = await getSeriesHistory(metricId, 3);
    const actual = saved?.history.at(-1);
    assert.ok(actual, `${metricId} must have a saved latest observation`);
    assert.equal(actual.date, expected.date, `${metricId} saved observation date must match the live API`);
    assert.ok(Math.abs(actual.value - expected.value) < 0.0001, `${metricId} saved value must match the live API`);
    console.log(`Saved ${metricId}: ${actual.date} ${actual.value}%`);
  }

  console.log(`Euro Area HICP component release simulation passed (run ${result.runId})`);
}

void main();
