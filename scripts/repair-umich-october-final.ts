import { fetchUmichReleaseSeries } from "../src/ingest/us-expectations";
import { processFetchedRelease } from "../src/ingest/release-processor";
import { ensureSchema, seedCatalog } from "../src/ingest/pipeline";
import { getDb } from "../src/db";
import { releases } from "../src/db/schema";
import { and, eq } from "drizzle-orm";

async function main() {
  await ensureSchema();
  await seedCatalog({ metricIds: ["us-umich-inflation-exp-1y", "us-umich-inflation-exp-5y"] });
  const releasedAt = "2026-10-23T14:00:00.000Z"; // 10:00 ET, UMich's announced final-release time.
  for (const [series, metricId] of [
    ["PX1", "us-umich-inflation-exp-1y"],
    ["PX5", "us-umich-inflation-exp-5y"],
  ] as const) {
    const points = await fetchUmichReleaseSeries(series);
    const point = points.at(-1);
    if (!point || point.date !== "2026-10-01") {
      throw new Error(`Unexpected ${series} official October observation: ${JSON.stringify(point)}`);
    }
    const result = await processFetchedRelease({
      metricId,
      scheduledAt: releasedAt,
      result: {
        periodDate: point.date,
        value: point.value,
        rawValue: point.value,
        releasedAt,
        releaseStage: "final",
        note: `Official University of Michigan Final Results for October 2026 (${series}); published 23 October 2026.`,
      },
    });
    console.log(metricId, JSON.stringify(result));
  }
  // UMich's final summary explicitly compares the 1Y measure with September
  // (4.6%). Preserve that published prior-period reading when the archive has
  // not yet exposed September as an observation.
  await getDb().update(releases).set({
    priorPeriodValue: 4.6,
    priorPeriodDate: "2026-09-01",
    changeVsPriorPeriod: 0.1,
  }).where(and(
    eq(releases.metricId, "us-umich-inflation-exp-1y"),
    eq(releases.periodDate, "2026-10-01"),
    eq(releases.releasedAt, releasedAt),
  ));
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
