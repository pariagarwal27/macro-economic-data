import assert from "node:assert/strict";
// @ts-ignore Node 24 supplies SQLite; this project's Node 20 type package predates it.
import { DatabaseSync } from "node:sqlite";
import { getCloudSourceConfig, getSourceConfig } from "../src/ingest/source-registry";
import { claimRelease, markReleaseRetry, markReleaseProcessed } from "../src/ingest/release-state";
import { isSafetyDue } from "../src/ingest/release-dispatcher";
import { METRICS } from "../src/catalog/metrics";
import { getSourceSnapshot } from "../src/ingest/cloud-source-cache";
import { processFetchedRelease } from "../src/ingest/release-processor";

async function main() {
  assert.equal(getSourceConfig("us-cpi")?.adapter, "lseg", "Local LSEG mapping must remain intact");
  assert.equal(getCloudSourceConfig("us-cpi")?.adapter, "pipeline", "Cloud CPI must use its official mapping");
  assert.equal(getCloudSourceConfig("us-pce")?.source, "bea");
  assert.equal(getCloudSourceConfig("ea-inflation-comp-5y5y"), null, "Desktop-only source must not claim cloud support");
  const pmiIds = [
    "us-ism-manufacturing-pmi", "us-ism-services-pmi",
    "us-sp-global-manufacturing-pmi", "us-sp-global-services-pmi",
    "uk-sp-global-manufacturing-pmi", "uk-sp-global-services-pmi", "uk-sp-global-composite-pmi",
    "ea-sp-global-manufacturing-pmi", "ea-sp-global-services-pmi", "ea-sp-global-composite-pmi",
  ];
  for (const id of pmiIds) {
    assert.equal(getSourceConfig(id)?.adapter, "pipeline", `${id} must use the official PMI fetcher locally`);
    assert.equal(getCloudSourceConfig(id), null, `${id} must remain excluded from D1 runtimes without a browser`);
  }

  const sqlite = new DatabaseSync(":memory:");
  const calls: string[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind(...args: (string | number | null)[]) {
          const execute = () => {
            const results = sqlite.prepare(sql).all(...args);
            return { results, meta: { changes: Number(sqlite.prepare("SELECT changes() AS n").get()!.n) } };
          };
          return {
            async all() { return execute(); },
            async raw() { return execute().results.map((row: Record<string, unknown>) => Object.values(row)); },
            async run() { return execute(); },
          };
        },
      };
    },
    async batch(statements: { all(): Promise<unknown> }[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  Object.assign(globalThis, { [Symbol.for("__cloudflare-context__")]: { env: { DB: database } } });
  const metric = METRICS.find(m => m.id === "us-cpi")!;
  let loads = 0;
  const load = async () => { loads++; return { value: 123.4 }; };
  assert.deepEqual(await getSourceSnapshot("test-provider", 600_000, load), { value: 123.4 });
  await getSourceSnapshot("test-provider", 600_000, load);
  assert.equal(loads, 1, "Related metrics must reuse a durable provider snapshot");
  sqlite.prepare("UPDATE cloud_source_cache SET expires_at = 0").run();
  await getSourceSnapshot("test-provider", 600_000, load);
  assert.equal(loads, 2, "Expired source snapshots must reload");
  const calendar = { metricId: metric.id, nextReleaseDate: "2026-10-01", nextReleaseAt: null } as any;
  assert.equal(isSafetyDue(metric, calendar, null, Date.parse("2026-10-20")), true, "Expired calendars must not disable future refreshes");
  assert.equal(isSafetyDue(metric, { ...calendar, nextReleaseDate: "2026-11-01" }, null, Date.parse("2026-10-20")), false);
  assert.equal(await claimRelease("us-cpi", "2026-10-06"), true);
  assert.equal(await claimRelease("us-cpi", "2026-10-06"), false, "Concurrent claim must fail");
  await markReleaseRetry("us-cpi", "2026-10-06", "not released yet");
  assert.equal(await claimRelease("us-cpi", "2026-10-06"), false, "Retry cooldown must survive across cycles");
  sqlite.prepare("UPDATE release_dispatch_state SET last_attempt_at = ?").run("2000-01-01T00:00:00.000Z");
  assert.equal(await claimRelease("us-cpi", "2026-10-06"), true);
  await markReleaseProcessed("us-cpi", "2026-10-06");
  assert.equal(await claimRelease("us-cpi", "2026-10-06"), false);
  assert.ok(calls.length > 0, "Release state must use the hosted database");
  sqlite.exec(`
    CREATE TABLE metrics(id TEXT PRIMARY KEY, docs_url TEXT, last_ingested_at TEXT, observation_count INTEGER);
    INSERT INTO metrics(id,docs_url) VALUES('test-metric','https://example.com/official');
    CREATE TABLE observations(id INTEGER PRIMARY KEY AUTOINCREMENT, metric_id TEXT,date TEXT,value REAL,raw_value REAL,released_at TEXT,vintage_date TEXT,is_latest INTEGER);
    INSERT INTO observations(metric_id,date,value,is_latest) VALUES('test-metric','2026-09-01',3.0,1);
    CREATE TABLE releases(id INTEGER PRIMARY KEY AUTOINCREMENT,metric_id TEXT,period_date TEXT,released_at TEXT,value REAL CHECK(value > -1000),expected_value REAL,prior_period_value REAL,prior_period_date TEXT,prior_release_value REAL,change_vs_prior_period REAL,change_vs_prior_release REAL,supporting_doc_url TEXT,notes TEXT);
  `);
  const unchanged = await processFetchedRelease({ metricId: "test-metric", result: { periodDate: "2026-09-01", value: 3.0 } });
  assert.equal(unchanged.updated, false);
  const updated = await processFetchedRelease({ metricId: "test-metric", result: { periodDate: "2026-10-01", value: 3.2 } });
  assert.equal(updated.updated, true);
  const repeat = await processFetchedRelease({ metricId: "test-metric", result: { periodDate: "2026-10-01", value: 3.2 } });
  assert.equal(repeat.updated, false);
  await assert.rejects(processFetchedRelease({ metricId: "test-metric", result: { periodDate: "2026-10-01", value: -2000 } }));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM observations").get()!.n, 2, "A failed release insert must roll back the observation write");
  assert.equal(sqlite.prepare("SELECT is_latest FROM observations WHERE date='2026-10-01'").get()!.is_latest, 1);
  console.log("Cloud source routing, D1 claims, retry cooldown and completed-claim checks passed");
}
void main();
