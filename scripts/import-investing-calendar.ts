import { readFile } from "node:fs/promises";
import { importInvestingCalendar } from "../src/ingest/investing-calendar";
import { ensureSchema } from "../src/ingest/pipeline";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run import:investing -- path/to/capture.json");
  const dump = JSON.parse(await readFile(file, "utf8")) as { rows?: Array<Record<string, unknown>> };
  if (!Array.isArray(dump.rows)) throw new Error("Capture must contain a rows array");
  await ensureSchema();
  const result = await importInvestingCalendar(dump.rows, file);
  console.log(`Imported ${result.rows} rows (${result.mapped} mapped). Calendar times must be UK time (GMT/BST).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
