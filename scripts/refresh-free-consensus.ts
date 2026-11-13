import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
async function main() {
  const { ensureSchema } = await import("../src/ingest/pipeline");
  const { normalizeInvestingConsensus, persistInvestingConsensus } = await import("../src/ingest/investing-consensus");
  const { fetchVisibleInvestingDay } = await import("./investing-ui-calendar");
  await ensureSchema();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { rows } = await fetchVisibleInvestingDay(date);
  const batch = normalizeInvestingConsensus({ complete: true, date, rows }, date);
  console.log(JSON.stringify(await persistInvestingConsensus([batch], date)));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Refresh failed"); process.exitCode = 1; });
