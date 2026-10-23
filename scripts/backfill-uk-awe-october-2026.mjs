import { createClient } from "@libsql/client";

// Values reported in the ONS Average weekly earnings in Great Britain
// bulletin released 20 October 2026, reference period June to August 2026.
// https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/bulletins/averageweeklyearningsingreatbritain/october2026
const client = createClient({ url: `file:${process.cwd().replaceAll("\\", "/")}/data/macro.db` });
const releaseDate = "2026-10-20";
const observationDate = "2026-08-01";
const officialLatest = [
  ["uk-awe-regular-yoy", 3.7],
  ["uk-awe-total-yoy", 3.7],
  ["uk-awe-real-regular-yoy", 0.6],
  ["uk-awe-real-total-yoy", 0.7],
];

try {
  await client.batch(officialLatest.flatMap(([metricId, value]) => [
    {
      sql: "UPDATE observations SET value = ?, raw_value = ?, released_at = ?, vintage_date = ?, is_latest = 1 WHERE metric_id = ? AND date = ? AND is_latest = 1",
      args: [value, value, releaseDate, releaseDate, metricId, observationDate],
    },
    {
      sql: "INSERT INTO observations (metric_id, date, value, raw_value, released_at, vintage_date, is_latest) SELECT ?, ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM observations WHERE metric_id = ? AND date = ? AND is_latest = 1)",
      args: [metricId, observationDate, value, value, releaseDate, releaseDate, metricId, observationDate],
    },
  ]), "write");

  for (const [metricId] of officialLatest) {
    const result = await client.execute({
      sql: "SELECT date, value, released_at, is_latest FROM observations WHERE metric_id = ? AND is_latest = 1 ORDER BY date DESC LIMIT 1",
      args: [metricId],
    });
    console.log(metricId, JSON.stringify(result.rows[0] ?? null));
  }
} finally {
  await client.close();
}
