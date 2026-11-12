import { runIngest } from "../src/ingest/pipeline";
import { getClient } from "../src/db";
const metricIds = ["hicp", "core", "gdp", "unemployment", "wage"].flatMap(component =>
  ["current", "next", "two-years", "lt"].map(horizon => `ea-spf-${component}-rolling-${horizon}`));
runIngest("backfill", { metricIds }).then(async result => {
  // These latest rolling forecasts are the same published observations as
  // the existing fixed-year series. Retain their publication timestamps,
  // rather than displaying the date the history was imported.
  for (const id of metricIds) {
    const source = id.replace('-rolling-current', '-target-2026').replace('-rolling-next', '-target-2027').replace('-rolling-two-years', '-target-2028').replace('-rolling-lt', '-target-lt').replace('ea-spf-hicp-target-lt', 'ea-spf-hicp-lt');
    const records = await getClient().execute({ sql: 'SELECT period_date, released_at FROM releases WHERE metric_id = ? ORDER BY released_at DESC LIMIT 1', args: [source] });
    const row = records.rows[0];
    if (row) await getClient().execute({ sql: 'UPDATE releases SET released_at = ? WHERE metric_id = ? AND period_date = ?', args: [String(row.released_at), id, String(row.period_date)] });
  }
  console.log(JSON.stringify(result, null, 2));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
