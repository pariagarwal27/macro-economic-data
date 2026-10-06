import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
// @ts-ignore Node 24 includes SQLite.
import { DatabaseSync } from "node:sqlite";
import dotenv from "dotenv";
import { fetchMetricFromOfficialSource } from "../src/ingest/source-adapter";

async function main() {
  const secrets: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    try { Object.assign(secrets, dotenv.parse(readFileSync(file))); } catch { /* Optional. */ }
  }
  Object.assign(process.env, secrets);
  const print = console.log.bind(console);
  const scrub = (value: unknown) => {
    let result = String(value);
    for (const secret of Object.values(secrets)) if (secret.length > 5) result = result.replaceAll(secret, "[redacted]");
    return result;
  };
  console.log = console.warn = console.error = (...values: unknown[]) => print(...values.map(scrub));
  mkdirSync(".cache/provider-verification", { recursive: true });
  const file = ".cache/provider-verification/macro.db";
  copyFileSync("data/macro.db", file);
  const sqlite = new DatabaseSync(file);
  const database = { prepare(sql: string) {
    const statement = (...args: any[]) => ({
      async all() { const results = sqlite.prepare(sql).all(...args); return { results, meta: { changes: 0 } }; },
      async raw() { return sqlite.prepare(sql).all(...args).map((row: any) => Object.values(row)); },
    });
    return { ...statement(), bind: statement };
  } };
  Object.assign(globalThis, { [Symbol.for("__cloudflare-context__")]: { env: { DB: database } } });
  let failures = 0;
  for (const metricId of process.argv.slice(2).length ? process.argv.slice(2) : ["us-cpi", "us-pce"]) {
    try {
      const result = await fetchMetricFromOfficialSource(metricId);
      if (!result || !Number.isFinite(result.value)) throw new Error("Provider returned no usable observation");
      print(JSON.stringify({ metricId, periodDate: result.periodDate, value: result.value, ok: true }));
    } catch (error) { failures++; console.error(metricId, error); }
  }
  sqlite.close();
  process.exitCode = failures ? 1 : 0;
}
void main();
