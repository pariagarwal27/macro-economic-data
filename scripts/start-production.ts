import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const port = process.env.PORT || "3000";

const spawnOptions = {
  stdio: "inherit" as const,
  env: { ...process.env, PORT: port },
  shell: isWindows,
};

async function initDb() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  try {
    const { ensureSchema, seedCatalog } = await import("../src/ingest/pipeline");
    console.log("[production] Initializing database schema and catalog...");
    await ensureSchema();
    await seedCatalog();
    console.log("[production] Database ready.");
  } catch (err) {
    console.warn("[production] Warning: Database schema check failed, proceeding:", err);
  }
}

async function main() {
  await initDb();

  console.log(`[production] Starting Next.js web server on port ${port} and background release worker...`);

  const children = [
    spawn(npm, ["run", "start"], spawnOptions),
    spawn(npm, ["run", "release:worker"], spawnOptions),
  ];

  if (process.env.LSEG_WORKER_AUTOSTART === "1") {
    const python = isWindows ? "python" : "python3";
    children.push(
      spawn(
        python,
        ["Economic_calendar/lseg_worker.py"],
        spawnOptions
      )
    );
  }

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

  for (const child of children) {
    child.on("error", (error) => {
      console.error("Child process failed:", error);
      stop(1);
    });

    child.on("exit", (code) => {
      if (!stopping && code !== null && code !== 0) {
        console.warn(`A child process exited with code ${code}`);
      }
    });
  }

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
}

main().catch((err) => {
  console.error("Production startup failed:", err);
  process.exit(1);
});
