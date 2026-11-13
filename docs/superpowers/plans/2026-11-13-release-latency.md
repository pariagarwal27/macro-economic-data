# Release latency implementation plan

**Goal:** Reduce application-controlled release latency toward the user's 2–3 second target without claiming a deadline for upstream publication or network responses.

**Architecture:** Keep exact-time arming and independent metric dispatch. Share only unfinished DOL downloads/parses, use a short retry interval near confirmed release instants, and bound browser notification batching.

**Tech stack:** TypeScript, Next.js, SQLite, pdf-parse, node:test.

**Spec:** User's November 13 request to investigate and reduce the consistent 5–7 second release-to-dashboard delay.

## Constraints and evidence

- Preserve existing working source routes, freshness checks, publication validation, and unrelated local edits.
- November 12 claims: first attempts armed at 13:29:55 UTC, processed at 13:30:04.757 / 13:30:05.489 UTC. No retry occurred.
- Official-source retry cooldown is currently 5 seconds; SSE polls every 500 ms; opening debounce is 2 seconds and resets on each batch.
- DOL currently independently downloads/parses the same document per metric. Read-only benchmark: concurrent initial/continuing calls took 1714 / 2160 ms; provider latency varies.
- Work in the user's existing running checkout so changes apply to the configured dashboard; do not reset existing edits, commit, or create a competing runtime.

## Tasks

- [x] Add a failing virtual-clock release retry regression: a source publishing at T+1s must be detected within 2s; retain slower polling outside a confirmed near-release window. Implement 500 ms retries for the first minute, 1s through five minutes, 5s otherwise; preserve the existing 1s LSEG policy.
- [x] Add failing DOL tests using a real tiny PDF fixture: simultaneous release metrics use one request, a later retry sees a new publication, background requests cannot feed release requests, failed work is cleared. Share only in-flight promises, send no-cache release requests, overlap module loading with PDF download, and warm the PDF engine during T-5s preparation without contacting the source.
- [x] Reduce the stream interval to 250 ms and card batching to a fixed 250 ms window, preserving immediate history merging and opening priorities within each batch.
- [x] Verify focused release, freshness, parser and stream tests; run repository TypeScript tests in isolated processes, type-check and inspect the diff. Record existing failures separately.

## Review focus

- Date-only schedules must not invent a release instant or trigger aggressive polling.
- Simultaneous metrics must not compete for duplicate DOL PDFs or reuse completed snapshots.
- Unfinished routine fetches must not supply a release-time request with pre-release data.
- Errors must clear in-flight state so retries recover.
- Sustained component updates must not postpone card opening indefinitely.

## Execution notes

Native execution is authorized by the user's fix request; continue without a plan approval handoff. Test-first changes and verification are recorded below.

- Regression evidence: old retry policy detected a T+1s publication at T+5.2s; new policy detects it within 2s. Old browser batching failed the 300ms opening check; updated batching passes.
- Focused tests: 17 passed, including exact-time arming, BEA/BLS/ONS freshness, real PDF parsing, retry recovery, browser timing and SQLite-to-SSE delivery (264ms).
- Repository suite: 236 tests, 226 passed, 10 failed. All ten failures were reproduced in an isolated source copy with the latency implementation reverted to HEAD. See the verification report for names.
- TypeScript check passed. Independent code review found no actionable issue.
- Runtime evidence: three verified project dashboard trees ran on ports 3000/3001/3002, each with a release worker. Stopped those trees and started one updated runtime. Verified one dev supervisor, one release worker, port 3000 only, and HTTP 200 for the dashboard and SSE route. Worker startup logs show the new retry policy.
- No historical observations were rewritten by diagnostics or tests. Tests used temporary/in-memory databases. Restarted application workers continue their normal authorized ingestion.
- Limitation: no future release was observed during this task. Upstream publication, download and provider delays can still exceed the target; the code records source, database and scheduled-to-commit timing for the next release.
