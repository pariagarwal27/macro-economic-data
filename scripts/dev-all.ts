import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const spawnOptions = {
  stdio: "inherit" as const,
  env: { ...process.env },
  shell: isWindows,
};

const children = [
  spawn(npm, ["run", "dev:next"], spawnOptions),
  spawn(npm, ["run", "release:worker"], spawnOptions),
  spawn(npm, ["run", "calendar:worker"], spawnOptions),
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
      stop(code);
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
