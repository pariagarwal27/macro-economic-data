import { getClient } from "../src/db";

async function main() {
  const client = getClient();
  const rels = await client.execute({ sql: "SELECT * FROM releases WHERE metric_id LIKE '%unemploy%'", args: [] });
  console.log("RELEASES:", rels.rows);
  const sched = await client.execute({ sql: "SELECT * FROM calendar_events WHERE metric_id LIKE '%unemploy%' LIMIT 10", args: [] });
  console.log("CALENDAR:", sched.rows);
}
main();
