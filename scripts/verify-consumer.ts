import { getDb } from "../src/db";
import { observations } from "../src/db/schema";
import { eq, and, gte } from "drizzle-orm";

async function main() {
  const db = getDb();

  const metricIds = [
    "uk-inflation-exp-1y",
    "uk-inflation-exp-2y",
    "uk-inflation-exp-5y",
    "uk-citi-yougov-inflation-exp-1y",
    "uk-citi-yougov-inflation-exp-5-10y",
  ];

  for (const metricId of metricIds) {
    const rows = await db
      .select()
      .from(observations)
      .where(
        and(
          eq(observations.metricId, metricId),
          gte(observations.date, "2026-01-01")
        )
      )
      .orderBy(observations.date);

    console.log("\n================================");
    console.log(metricId);
    console.log("Count:", rows.length);

    console.table(
      rows.map((r) => ({
        date: r.date,
        value: r.value,
        vintageDate: r.vintageDate,
        isLatest: r.isLatest,
      }))
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
