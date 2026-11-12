import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
async function main() {
  const { ensureSchema } = await import("../src/ingest/pipeline");
  const { refreshFreeConsensus } = await import("../src/ingest/free-consensus");
  await ensureSchema();
  console.log(JSON.stringify(await refreshFreeConsensus()));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Refresh failed"); process.exitCode = 1; });
