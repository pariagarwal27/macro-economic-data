import { loadEnvConfig } from "@next/env";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

loadEnvConfig(process.cwd());
const localPython = path.resolve("tmp/lseg-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.LSEG_PYTHON || (existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
const child = spawn(python, ["Economic_calendar/lseg_worker.py"], { stdio: "inherit", shell: false });
child.on("error", error => { console.error("LSEG bridge failed:", error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
