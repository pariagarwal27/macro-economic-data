import { spawn } from "node:child_process";

const tail = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "tail", "macro-economy-tracker", "--format", "json"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let eventText = "", depth = 0, inString = false, escaped = false;
const timeout = setTimeout(() => { console.log("No scheduled event observed in this watch window"); tail.kill(); }, 600_000);
tail.stdout.setEncoding("utf8");
tail.stdout.on("data", chunk => {
  for (const character of chunk) {
    if (!depth) {
      if (character !== "{") continue;
      eventText = "{"; depth = 1; inString = false; escaped = false;
      continue;
    }
    eventText += character;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") depth--;
    if (depth) continue;
    try {
      const event = JSON.parse(eventText);
      if (!event.event?.cron) {
        if (process.argv.includes("--errors")) {
          const errors = (event.logs ?? []).filter(log => log.level === "error").flatMap(log => log.message ?? []);
          if (errors.length) console.log(JSON.stringify({ path: new URL(event.event.request.url).pathname,
            errors: errors.map(message => String(message).slice(0, 800)) }));
        }
        continue;
      }
      const messages = (event.logs ?? []).flatMap(log => log.message ?? []);
      const resultText = messages.find(message => typeof message === "string" && message.startsWith('{"ok":'));
      const result = resultText ? JSON.parse(resultText) : null;
      console.log(JSON.stringify({
        cron: event.event.cron, scheduledTime: event.event.scheduledTime,
        outcome: event.outcome, cpuTime: event.cpuTime,
        checkedAt: result?.checkedAt, attempted: result?.attempted,
        results: result?.results?.map(item => ({ metricId: item.metricId, status: item.status, updated: item.processed?.updated })),
        exceptions: (event.exceptions ?? []).map(error => error.message),
      }));
      if (event.outcome === "ok" && result?.ok) { clearTimeout(timeout); tail.kill(); }
    } catch { /* Ignore non-event CLI output. */ }
  }
});
tail.stderr.on("data", chunk => console.error(chunk.toString()));
tail.on("exit", code => { clearTimeout(timeout); if (code && code !== 1) process.exitCode = code; });
