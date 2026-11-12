import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
async function main() {
  const key = process.env.TRADING_ECONOMICS_API_KEY;
  if (!key) throw new Error("TRADING_ECONOMICS_API_KEY is not configured");
  const { ensureSchema } = await import("../src/ingest/pipeline");
  const { refreshTradingEconomicsCalendar } = await import("../src/ingest/trading-economics-calendar");
  await ensureSchema();
  console.log(JSON.stringify(await refreshTradingEconomicsCalendar(key)));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Refresh failed"); process.exitCode = 1; });
