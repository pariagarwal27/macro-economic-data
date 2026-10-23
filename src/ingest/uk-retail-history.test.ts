import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { persistUkRetailHistory } from './uk-retail-history';

test('scheduled retail history persists revised months and newest month atomically without altering release records', async () => {
  const client = createClient({url:'file::memory:'});
  try {
    await client.execute('CREATE TABLE observations(metric_id TEXT,date TEXT,value REAL,raw_value REAL,released_at TEXT,vintage_date TEXT,is_latest INTEGER)');
    await client.execute('CREATE TABLE metrics(id TEXT,earliest_available TEXT,observation_count INTEGER,last_ingested_at TEXT)');
    const id = 'uk-retail-sales-ex-fuel';
    await client.execute({sql:'INSERT INTO observations VALUES(?,?,?,?,?,?,?)',args:[id,'2026-08-01',0.6,0.6,'2026-09-25T06:00:00Z','old',1]});
    await client.execute({sql:'INSERT INTO metrics(id) VALUES(?)',args:[id]});
    type Statement = { sql: string; args: (string | number | null)[] };
    const store = {execute: (statement: Statement) => client.execute(statement), batch: (statements: Statement[]) => client.batch(statements,'write')};
    await persistUkRetailHistory(id,[{date:'2026-08-01',value:0.9},{date:'2026-09-01',value:-0.7}],'2026-10-23T06:00:00Z',store);
    const rows = await client.execute('SELECT date,value,released_at FROM observations ORDER BY date');
    assert.deepEqual(rows.rows.map(row => [row.date,row.value,row.released_at]),[
      ['2026-08-01',0.9,'2026-09-25T06:00:00Z'],['2026-09-01',-0.7,'2026-10-23T06:00:00Z'],
    ]);
    await assert.rejects(persistUkRetailHistory(id,[{date:'2026-07-01',value:1},{date:'2026-09-01',value:1}],'2026-10-23',store),/Incomplete/);
    await assert.rejects(persistUkRetailHistory(id,[{date:'2026-08-01',value:1}],'2026-10-23',store),/older/);
    await assert.rejects(persistUkRetailHistory(id,[{date:'2026-09-01',value:1}],'2026-10-23',store),/lost earlier/);
    const failingStore = { ...store, batch: (statements: Statement[]) => client.batch([...statements,{sql:'INSERT INTO missing_table VALUES(1)',args:[]}],'write') };
    await assert.rejects(persistUkRetailHistory(id,[{date:'2026-08-01',value:99},{date:'2026-09-01',value:99}],'2026-10-23',failingStore));
    assert.deepEqual((await client.execute('SELECT value FROM observations ORDER BY date')).rows.map(row => row.value),[0.9,-0.7]);
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM observations')).rows[0].n,2);
  } finally { client.close(); }
});
