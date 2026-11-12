/**
 * Investing.com capture — original Jul'25→Aug'26 method:
 *   headed browser → calendar page → inject __invCaptureMonth (Custom dates + Load more + DOM)
 *
 * Usage:
 *   npx tsx scripts/capture-investing-month.ts 2026-08-09 2026-08-31 2026-08
 *   npx tsx scripts/capture-investing-month.ts 2026-09-01 2026-09-03 2026-09
 */
import fs from "fs";
import path from "path";
import { createInterface } from "node:readline/promises";
import { INVESTING_BROWSER_CAPTURE_JS } from "./investing-browser-capture";
import { isoToPickerDate } from "./investing-date-format";
import { launchInvestingContext, parseArgs } from "./investing-browser-session";
import { importInvestingCalendar } from "../src/ingest/investing-calendar";
import { ensureSchema } from "../src/ingest/pipeline";

type CaptureDump = { rows: Array<Record<string, unknown>>; range?: { from?: string; to?: string } };

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const today = new Date();
  const from = positional[0] ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
  const to = positional[1] ?? new Date(Date.parse(`${from}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const outStem = positional[2] ?? from.slice(0, 7);
  const outDir = path.join(process.cwd(), "data", "investing");
  const outFile = path.join(outDir, `${outStem}.json`);

  fs.mkdirSync(outDir, { recursive: true });

  const { context, page } = await launchInvestingContext({ fresh: flags.has("--fresh") });

  try {
    console.log("Opening economic calendar…");
    await page.goto("https://www.investing.com/economic-calendar/", {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForSelector("table[class*=datatable]", { timeout: 300_000 });

    if (!process.stdin.isTTY) throw new Error("Interactive terminal required to confirm the calendar timezone.");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { await prompt.question("Set the Investing.com calendar timezone to UK time (GMT/BST), then press Enter to capture: "); }
    finally { prompt.close(); }
    console.log(`Capturing ${from} → ${to} (${isoToPickerDate(from)} → ${isoToPickerDate(to)})…`);

    const { result, dump } = await page.evaluate(
      async ({ js, fromPicker, toPicker, rangeFrom, rangeTo }) => {
        // eslint-disable-next-line no-eval
        eval(js);
        // @ts-expect-error injected
        const capture = await __invCaptureMonth(fromPicker, toPicker, rangeFrom, rangeTo);
        return { result: capture, dump: (window as Window & { __invLastDump?: CaptureDump }).__invLastDump };
      },
      {
        js: INVESTING_BROWSER_CAPTURE_JS,
        fromPicker: isoToPickerDate(from),
        toPicker: isoToPickerDate(to),
        rangeFrom: from,
        rangeTo: to,
      }
    );

    if (!result?.ok || !dump?.rows?.length || result.stillHasLoadMore) {
      await page.screenshot({
        path: path.join(outDir, `capture-fail-${outStem}.png`),
        fullPage: true,
      });
      console.error(JSON.stringify({ result, dumpRows: dump?.rows?.length ?? 0 }, null, 2));
      process.exitCode = 1;
      return;
    }

    const capturedRows = dump.rows as Array<Record<string, unknown>>;
    let rows = capturedRows;
    if (fs.existsSync(outFile)) {
      const existing = JSON.parse(fs.readFileSync(outFile, "utf8")) as {
        rows: Array<Record<string, unknown>>;
        range?: { from?: string; to?: string };
      };
      const seen = new Map(existing.rows.map((r, index) => [`${r.date}|${r.time}|${r.country}|${r.event}`, index]));
      for (const row of rows) {
        const key = `${row.date}|${row.time}|${row.country}|${row.event}`;
        const index = seen.get(key);
        if (index === undefined) {
          seen.set(key, existing.rows.length);
          existing.rows.push(row);
        } else existing.rows[index] = row;
      }
      rows = existing.rows;
      dump.rows = rows;
      dump.range = {
        from: [existing.range?.from, from, dump.range?.from].filter(Boolean).sort()[0],
        to: [existing.range?.to, to, dump.range?.to].filter(Boolean).sort().slice(-1)[0],
      };
    }

    fs.writeFileSync(outFile, JSON.stringify(dump, null, 2));
    await ensureSchema();
    const imported = await importInvestingCalendar(capturedRows, outFile);
    console.log(`Imported ${imported.rows} calendar rows (${imported.mapped} mapped to metrics).`);
    const dates = rows.map((r) => String(r.date)).filter(Boolean);
    console.log(
      JSON.stringify(
        {
          outFile,
          rows: rows.length,
          minDate: dates.reduce((a, b) => (a < b ? a : b)),
          maxDate: dates.reduce((a, b) => (a > b ? a : b)),
          loadMoreClicks: result.clicks,
          us: rows.filter((r) => r.country === "US").length,
          uk: rows.filter((r) => r.country === "UK").length,
          ea: rows.filter((r) => r.country === "EA").length,
        },
        null,
        2
      )
    );
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
