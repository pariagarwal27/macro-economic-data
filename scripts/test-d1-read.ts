import assert from "node:assert/strict";
import { readD1 } from "../src/db/d1-read";

async function main() {
  const calls: unknown[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      return { bind(...args: unknown[]) {
        calls.push(args);
        return { async all() { return { results: [{ value: 3.2 }] }; } };
      } };
    },
  };
  const result = await readD1(database as unknown as D1Database, {
    sql: "SELECT value FROM observations WHERE metric_id = ? LIMIT ?",
    args: ["us-cpi", 24],
  });
  assert.deepEqual(result.rows, [{ value: 3.2 }]);
  assert.deepEqual(calls[1], ["us-cpi", 24]);
  console.log("D1 parameter binding and result mapping passed");
}
void main();
