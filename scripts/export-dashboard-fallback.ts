import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// @ts-ignore Node 24 includes SQLite.
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { METRICS } from "../src/catalog/metrics";

async function main() {
  const sqlite = new DatabaseSync("data/macro.db", { readOnly: true });
  sqlite.prepare("ATTACH DATABASE ? AS schedule").run(path.resolve("Economic_calendar/economic_calendar.db"));
  sqlite.exec("CREATE TEMP VIEW calendar AS SELECT * FROM schedule.calendar");
  const database = {
    prepare(sql: string) {
      const prepare = (...args: any[]) => ({
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async raw() { return sqlite.prepare(sql).all(...args).map((row: any) => Object.values(row)); },
      });
      return { ...prepare(), bind: prepare };
    },
  };
  Object.assign(globalThis, { [Symbol.for("__cloudflare-context__")]: { env: { DB: database } } });
  async function save(url: string, route: any, params?: any) {
    const response = await route.GET(new NextRequest(`https://snapshot.invalid${url}`), { params: Promise.resolve(params) });
    if (!response.ok) throw new Error(`Snapshot ${url}: HTTP ${response.status}`);
    const target = path.join("public/data-fallback", `${url.split("?")[0]}.json`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, await response.text());
  }
  const dashboard = await import("../src/app/api/dashboard/[region]/route");
  for (const region of ["US", "UK", "EA"]) await save(`/api/dashboard/${region}`, dashboard, { region });
  for (const name of ["metrics", "economic-calendar", "desk-matrix", "desk-smoothed", "data-freshness", "calendar"]) {
    await save(`/api/${name}`, await import(`../src/app/api/${name}/route.ts`));
  }
  const details = await import("../src/app/api/metrics/[id]/route");
  for (const metric of METRICS) await save(`/api/metrics/${metric.id}?limit=360`, details, { id: metric.id });
  sqlite.close();
  console.log(`Saved dashboard, calendar, desk and ${METRICS.length} metric snapshots from the original SQLite files`);
}
void main();
