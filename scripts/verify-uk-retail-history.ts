import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getClient } from '../src/db';

async function main() {
  const folder = path.resolve(process.argv[2] ?? '');
  const summary = JSON.parse(await fs.readFile(path.join(folder, 'summary.json'), 'utf8'));
  const client = getClient();
  const histories = new Map<string, Map<string, number>>();
  let verified = 0;
  try {
    for (const item of summary.series) {
      const csv = await fs.readFile(path.join(folder, item.series + '.csv'), 'utf8');
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const expected = csv.split(/\r?\n/).flatMap(line => {
        const match = line.match(/^"?(\d{4}) ([A-Z]{3})"?,"?(-?\d+(?:\.\d+)?)"?$/);
        if (!match) return [];
        const month = months.indexOf(match[2]) + 1;
        assert.ok(month > 0);
        return [{ date: `${match[1]}-${String(month).padStart(2, '0')}-01`, value: Number(match[3]) }];
      }).sort((a,b) => a.date.localeCompare(b.date));
      const actual = await client.execute({ sql: 'SELECT date,value,raw_value FROM observations WHERE metric_id=? ORDER BY date', args: [item.id] });
      assert.equal(expected.length, item.count);
      assert.deepEqual(actual.rows.map(row => ({ date: String(row.date), value: Number(row.value) })), expected);
      assert.ok(actual.rows.every(row => Number(row.value) === Number(row.raw_value)));
      histories.set(item.series, new Map(expected.map(p => [p.date,p.value])));
      verified += expected.length;
    }
    const codes = ['J5EC','J45W','J5EB','J45U','J5EG','J45R'];
    const dates = [...new Set([...histories.values()].flatMap(history => [...history.keys()]))].sort();
    const rows = ['Month,Headline MoM,Ex-fuel MoM,Headline YoY,Ex-fuel YoY,Headline 3m3m,Ex-fuel 3m3m',
      ...dates.map(date => [date,...codes.map(code => histories.get(code)!.get(date) ?? '')].join(','))];
    await fs.writeFile(path.join(folder, 'verified-history.csv'), rows.join('\n') + '\n');
    const result = { verifiedObservationsIncludingAlias: verified, uniqueSeries: histories.size, mismatches: 0, missingMonths: 0, duplicates: 0, verifiedAt: new Date().toISOString() };
    await fs.writeFile(path.join(folder, 'verification.json'), JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally { client.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
