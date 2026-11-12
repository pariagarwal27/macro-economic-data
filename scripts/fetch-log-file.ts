import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

const logPath = path.join(process.cwd(), "data", "fetch-logs.md");
const retentionMs = 5 * 24 * 60 * 60 * 1000;
const maxLogBytes = 32 * 1024 * 1024;
const maxLineChars = 64 * 1024;
const header = [
  "# Local dashboard fetch logs",
  "",
  "Combined stdout and stderr from the local dashboard and its background workers.",
  "Entries are timestamped when received and older than five days are removed.",
  "",
];
const headerText = `${header.join("\n")}\n`;
let logBytes = 0;

function ensureLogFile() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, headerText, "utf8");
    logBytes = Buffer.byteLength(headerText);
  } else {
    logBytes = fs.statSync(logPath).size;
  }
}

function resetLogFile() {
  fs.writeFileSync(logPath, headerText, "utf8");
  logBytes = Buffer.byteLength(headerText);
}

function pruneExpiredLogs() {
  ensureLogFile();
  // This ignored local diagnostic log must stay small enough to read safely.
  if (logBytes > maxLogBytes) {
    resetLogFile();
    return;
  }
  const cutoff = Date.now() - retentionMs;
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  const retained = lines.filter((line) => {
    if (!line.startsWith("- **")) return false;
    const match = line.match(/^- \*\*(\d{4}-\d{2}-\d{2}T[^*]+)\*\*/);
    if (!match) return true;
    const timestamp = Date.parse(match[1]);
    return !Number.isFinite(timestamp) || timestamp >= cutoff;
  });
  const contents = retained.length ? `${headerText}${retained.join("\n")}\n` : headerText;
  fs.writeFileSync(logPath, contents, "utf8");
  logBytes = Buffer.byteLength(contents);
}

function redact(line: string) {
  return line
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:api[_-]?key|key|token|access_token|client_secret)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|access_token|client_secret|password|token)\s*[=:]\s*)[^\s,;&]+/gi, "$1[redacted]");
}

export function startFetchLogRetention() {
  ensureLogFile();
  pruneExpiredLogs();
  const timer = setInterval(pruneExpiredLogs, 60 * 60 * 1000);
  timer.unref();
  return timer;
}

function appendLine(source: string, line: string) {
  if (!line.trim()) return;
  const timestamp = new Date().toISOString();
  const clippedLine = line.length > maxLineChars ? `${line.slice(0, maxLineChars)}… [line truncated]` : line;
  const safeLine = redact(clippedLine).replace(/\|/g, "\\|");
  const entry = `- **${timestamp}** \`${source}\` — ${safeLine}\n`;
  const entryBytes = Buffer.byteLength(entry);
  if (logBytes + entryBytes > maxLogBytes) resetLogFile();
  fs.appendFileSync(logPath, entry, "utf8");
  logBytes += entryBytes;
}

/** Forward child output unchanged to the terminal and mirror each line to Markdown. */
export function pipeChildOutput(child: ChildProcess, name: string) {
  for (const channel of ["stdout", "stderr"] as const) {
    const stream = child[channel];
    if (!stream) continue;
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      (channel === "stdout" ? process.stdout : process.stderr).write(chunk);
      const lines = `${pending}${chunk}`.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) appendLine(`${name} ${channel}`, line);
      while (pending.length > maxLineChars) {
        appendLine(`${name} ${channel}`, pending.slice(0, maxLineChars));
        pending = pending.slice(maxLineChars);
      }
    });
    stream.on("end", () => {
      if (pending) appendLine(`${name} ${channel}`, pending);
      pending = "";
    });
  }
}
