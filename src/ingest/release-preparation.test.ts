import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";

test("a scheduled release is discovered during preparation but retains its exact publication time", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "macro-release-calendar-"));
  const calendarPath = path.join(directory, "calendar.db");
  process.env.CALENDAR_DB_PATH = calendarPath;
  process.env.DATABASE_URL = `file:${path.join(directory, "macro.db").replace(/\\/g, "/")}`;
  const calendar = createClient({url:`file:${calendarPath.replace(/\\/g, "/")}`});
  try {
    await calendar.execute("CREATE TABLE calendar(metric_id TEXT, metric TEXT, source TEXT, family TEXT, next_release_date TEXT, next_release_at TEXT, status TEXT, official_source TEXT, official_evidence TEXT, updated_at TEXT)");
    await calendar.execute({sql:"INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?)",args:["us-umich-sentiment", "Sentiment", "LSEG", "survey", "2026-10-28", "2026-10-28T13:30:00Z", "scheduled", null, null, null]});
    await calendar.execute({sql:"INSERT INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?)",args:["us-nfp", "Payrolls", "BLS", "jobs", "2026-10-28", "2026-10-28T13:30:00Z", "scheduled", null, null, null]});
    const { getDueReleaseCandidates } = await import("./release-dispatcher");
    const before = new Date("2026-10-28T13:29:55Z");
    assert.equal((await getDueReleaseCandidates(before)).some(item => item.metricId === "us-umich-sentiment"), false);
    const prepared = (await getDueReleaseCandidates(before, 5000)).find(item => item.metricId === "us-umich-sentiment");
    assert.equal(prepared?.scheduledAt, "2026-10-28T13:30:00Z");
    assert.equal((await getDueReleaseCandidates(before, 5000)).find(item => item.metricId === "us-unemployment")?.scheduledAt, "2026-10-28T13:30:00Z", "dashboard metrics in the same official release must share its clock");
  } finally {
    calendar.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
