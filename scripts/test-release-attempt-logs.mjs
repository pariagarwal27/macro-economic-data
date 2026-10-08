import assert from "node:assert/strict";
import { formatReleaseLog, nextReleaseRetryAt } from "../src/ingest/release-logging.ts";

const output = formatReleaseLog({
  event: "attempt_started",
  attempt: 2,
  metricId: "us-nyfed-sce-1y",
  at: "2026-10-07T15:00:00.000Z",
});
assert.ok(output.startsWith("[release-worker] "));
assert.deepEqual(JSON.parse(output.slice("[release-worker] ".length)), {
  event: "attempt_started",
  attempt: 2,
  metricId: "us-nyfed-sce-1y",
  at: "2026-10-07T15:00:00.000Z",
});

assert.equal(
  nextReleaseRetryAt("2026-10-07T15:00:00.000Z", 120_000),
  "2026-10-07T15:02:00.000Z",
  "retry logs must state the exact next eligible time",
);

const safeError = formatReleaseLog({
  event: "attempt_failed",
  error: "HTTP 403 https://api.example.test/?api_key=secret-value Authorization: Bearer abc123",
});
assert.doesNotMatch(safeError, /secret-value|abc123/, "secrets must not leak into terminal logs");

console.log("Release attempt log formatting, retry timestamp, and secret redaction passed.");
