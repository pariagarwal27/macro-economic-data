import { desc, eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { metrics, observations } from "../src/db/schema";
import { processFetchedRelease } from "../src/ingest/release-processor";

async function main() {
  const db = getDb();

  const rows = await db
    .select({
      metricId: metrics.id,
      periodDate: observations.date,
      value: observations.value,
    })
    .from(observations)
    .innerJoin(metrics, eq(metrics.id, observations.metricId))
    .orderBy(desc(observations.date))
    .limit(1);

  if (!rows[0]) {
    throw new Error("No observation found in database");
  }

  const row = rows[0];

  console.log("Testing metric:");
  console.log(row);

  const result = await processFetchedRelease({
    metricId: row.metricId,
    result: {
      periodDate: row.periodDate,
      value: Number(row.value),
    },
  });

  console.log("\nResult:");
  console.log(JSON.stringify(result, null, 2));

  if (
    result.updated === false &&
    result.reason === "no-new-release"
  ) {
    console.log("\n✅ ISSUE #1 TEST PASSED");
    console.log(
      "Existing observation was correctly treated as NO_NEW_RELEASE."
    );
    process.exit(0);
  }

  console.error("\n❌ ISSUE #1 TEST FAILED");
  console.error(
    "Expected updated=false and reason=no-new-release."
  );
  process.exit(1);
}

main().catch((error) => {
  console.error("\n❌ TEST ERROR");
  console.error(error);
  process.exit(1);
});
