import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
async function main() {
  const { ensureSchema } = await import("../src/ingest/pipeline");
  const { refreshShowMyTradesCalendar } = await import("../src/ingest/showmytrades-calendar");
  await ensureSchema();
  console.log(JSON.stringify(await refreshShowMyTradesCalendar()));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Refresh failed"); process.exitCode = 1; });
