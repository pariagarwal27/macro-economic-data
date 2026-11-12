import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EA_MARKET_METRIC_IDS } from "../src/ingest/ea-market-refresh";

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ea-market-ingest-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "test.db").replace(/\\/g, "/")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  let shortHistory = false;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://localhost");
    assert.ok(["EUHICP1Y=", "EUHICP2Y=", "EUHICP5Y=", "EUHICP10Y=", "EUIL5Y5Y=R"].includes(url.searchParams.get("ric")!));
    const points = [{ date: "2020-03-18", value: -0.3 }, { date: "2026-10-27", value: 2.1 }];
    const refresh = url.searchParams.get("start") !== "1990-01-01";
    if (refresh) assert.equal(url.searchParams.get("start"), "2026-10-20");
    const daily = [{ date: "2026-10-28", value: 2.12 }, { date: "2026-10-29", value: 2.15 }, { date: "2026-10-30", value: 2.2 }];
    response.end(JSON.stringify(url.pathname === "/history"
      ? { ok: true, observations: refresh ? daily : shortHistory ? points.slice(1) : points }
      : { ok: true, periodDate: "2026-10-30", value: 2.2 }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  process.env.LSEG_WORKER_URL = `http://127.0.0.1:${address.port}`;
  const { runIngest } = await import("../src/ingest/pipeline");
  const { getSeriesHistories } = await import("../src/data/dashboard");
  const { getClient } = await import("../src/db");
  try {
    const backfill = await runIngest("backfill", { metricIds: EA_MARKET_METRIC_IDS });
    assert.deepEqual(backfill.failures, []);
    assert.equal(backfill.metricsProcessed, 5);
    let histories = await getSeriesHistories(EA_MARKET_METRIC_IDS);
    for (const id of EA_MARKET_METRIC_IDS) {
      const series = histories[id];
      assert.ok(series);
      assert.deepEqual(series.history.map(p => ({ date: p.date, value: p.value })),
        [{ date: "2020-03-18", value: -0.3 }, { date: "2026-10-27", value: 2.1 }]);
    }
    shortHistory = true;
    await runIngest("backfill", { metricIds: EA_MARKET_METRIC_IDS });
    const refresh = await runIngest("refresh", { metricIds: EA_MARKET_METRIC_IDS });
    assert.deepEqual(refresh.failures, []);
    histories = await getSeriesHistories(EA_MARKET_METRIC_IDS);
    for (const id of EA_MARKET_METRIC_IDS) {
      const series = histories[id];
      assert.ok(series);
      assert.deepEqual(series.history.map(p => p.value), [-0.3, 2.1, 2.12, 2.15, 2.2],
        `${id}: short backfills must preserve earlier history and live refresh must append the daily tip`);
    }
    console.log("All five LSEG routes: backfill, negative values, non-destructive merge, live update and chart-history payload passed in an isolated test database.");
  } finally {
    getClient().close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
