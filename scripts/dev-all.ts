import { spawn } from "node:child_process";
import { pipeChildOutput, startFetchLogRetention } from "./fetch-log-file";

startFetchLogRetention();

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const spawnOptions = {
  stdio: ["inherit", "pipe", "pipe"] as ["inherit", "pipe", "pipe"],
  env: { ...process.env },
  shell: isWindows,
};

const children: ReturnType<typeof spawn>[] = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;

  stopping = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function main() {
  const { ensureSchema, seedCatalog } = await import("../src/ingest/pipeline");
  await ensureSchema();
  // Align local development databases with newly added metrics without
  // deleting existing observations or releases.
  await seedCatalog({ cleanupOrphans: false });

  // Older local databases may predate the paired parent MoM series. Backfill
  // only when their history is absent, so the first run after this change
  // repairs the PPI cards and later starts remain fast.
  const parentPpiMomIds = ["uk-ppi-output-mom", "uk-ppi-input-mom"];
  const { getSeriesHistories } = await import("../src/data/dashboard");
  const existing = await getSeriesHistories(parentPpiMomIds, 2);
  const missing = parentPpiMomIds.filter((id) => !existing[id]?.history.length);
  if (missing.length) {
    const { runIngest } = await import("../src/ingest/pipeline");
    await runIngest("backfill", { metricIds: missing });
  }

  const next = spawn(npm, ["run", "dev:next"], spawnOptions);
  const releases = spawn(npm, ["run", "release:worker"], spawnOptions);
  const calendar = spawn(npm, ["run", "calendar:worker"], spawnOptions);
  children.push(next, releases, calendar);
  pipeChildOutput(next, "next");
  pipeChildOutput(releases, "release-worker");
  pipeChildOutput(calendar, "calendar-worker");

  if (process.env.LSEG_WORKER_AUTOSTART === "1") {
    const lseg = spawn(npm, ["run", "release:lseg"], spawnOptions);
    children.push(lseg);
    pipeChildOutput(lseg, "lseg-worker");
  }

  for (const child of children) {
    child.on("error", (error) => {
      console.error("Child process failed:", error);
      stop(1);
    });

    child.on("exit", (code) => {
      if (!stopping && code !== null && code !== 0) {
        stop(code);
      }
    });
  }
}

main().catch((error) => {
  console.error("Development database initialization failed:", error);
  process.exit(1);
});
