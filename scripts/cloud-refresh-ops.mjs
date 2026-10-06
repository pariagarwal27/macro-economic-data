import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const environment = {};
for (const name of [".env", ".env.local"]) {
  try { Object.assign(environment, dotenv.parse(readFileSync(name))); } catch { /* Optional file. */ }
}
const keys = ["CRON_SECRET", "BEA_API_KEY", "BLS_API_KEY", "CENSUS_API_KEY", "FRED_API_KEY"];
const secrets = Object.fromEntries(keys.filter(key => environment[key]).map(key => [key, environment[key]]));
if (!secrets.CRON_SECRET) throw new Error("The local environment must supply CRON_SECRET");

if (process.argv[2] === "configure") {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "secret", "bulk"], {
    input: JSON.stringify(secrets), encoding: "utf8", windowsHide: true,
  });
  console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else if (process.argv[2] === "run") {
  const response = await fetch(`https://macro-economy-tracker.macro-economy-tracker.workers.dev/api/cron/releases`, {
    headers: { authorization: `Bearer ${secrets.CRON_SECRET}` },
    signal: AbortSignal.timeout(180000),
  });
  let body = await response.text();
  for (const value of Object.values(secrets)) body = body.replaceAll(value, "[redacted]");
  console.log(`HTTP ${response.status}\n${body}`);
  if (!response.ok) process.exitCode = 1;
} else {
  throw new Error("Use configure or run");
}
