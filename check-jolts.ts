import { createClient } from "@libsql/client";

const db = createClient({
  url: "file:./data/macro.db",
});

async function main() {
  const result = await db.execute({
    sql: `
      SELECT metric_id, date, value
      FROM (
        SELECT
          metric_id,
          date,
          value,
          ROW_NUMBER() OVER (
            PARTITION BY metric_id
            ORDER BY date DESC
          ) AS rn
        FROM observations
        WHERE metric_id LIKE ?
      )
      WHERE rn <= 3
      ORDER BY metric_id, date DESC
    `,
    args: ["uk-%"],
  });

  console.table(result.rows);
}

main();