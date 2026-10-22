import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const spawnOptions = {
  stdio: "inherit" as const,
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

  children.push(
    spawn(npm, ["run", "dev:next"], spawnOptions),
    spawn(npm, ["run", "release:worker"], spawnOptions),
    spawn(npm, ["run", "calendar:worker"], spawnOptions),
  );

  if (process.env.LSEG_WORKER_AUTOSTART === "1") {
    const python = isWindows ? "python" : "python3";
    children.push(spawn(python, ["Economic_calendar/lseg_worker.py"], spawnOptions));
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
