import { createClient } from "@libsql/client";
import path from "path";

async function main() {
  const dbPath = path.join(
    process.cwd(),
    "Economic_calendar",
    "economic_calendar.db"
  );

  const client = createClient({
    url: `file:${dbPath.replace(/\\/g, "/")}`,
  });

  const result = await client.execute(`
    SELECT
      metric_id,
      metric,
      source,
      family,
      next_release_date,
      next_release_at,
      status,
      official_source
    FROM calendar
    WHERE metric_id IN (
      'us-cleveland-exp-inf-1y',
      'us-cleveland-exp-inf-2y',
      'us-breakeven-1y',
      'us-breakeven-2y',
      'us-ism-manufacturing-pmi',
      'us-ism-services-pmi',
      'us-adp-change',
      'uk-awe-total-yoy'
    )
    ORDER BY metric_id
  `);

  console.table(result.rows);
  client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
