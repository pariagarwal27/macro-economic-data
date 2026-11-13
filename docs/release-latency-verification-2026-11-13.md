# Release latency verification — November 13, 2026

The application now uses 500ms public-source retries for the first minute after a confirmed release instant, 1s through five minutes, and the existing 5s cadence afterward. LSEG retains its prior cadence. Date-only releases retain the slower cadence because they have no confirmed publication instant.

DOL metrics share unfinished PDF work, never completed snapshots. Release downloads are separate from routine downloads and request fresh content. The PDF engine loads during T-5s preparation without requesting embargoed data. The live stream polls every 250ms, and automatic card opening batches for a fixed 250ms from the first update. Visible metric history is still merged immediately.

Three duplicate dashboard runtimes were consolidated into one instance on port 3000. The updated release worker's startup log confirms the new policy. Read-only checks returned HTTP 200 for `/country/us` and `/api/releases/stream`.

## Evidence

- November 12 claims were processed on their first attempts, 4.757s and 5.489s after the scheduled release. This establishes that claims latency also occurred before any retry.
- The retry regression detected a source publishing at T+1s at T+5.2s before the fix; detection is within 2s after the fix in the controlled test.
- A concurrent live claims benchmark after sharing used one official PDF request and completed in 1.936s. This is an adapter benchmark, not a measured future release-to-dashboard deadline. Network timings varied across runs.
- SQLite-to-SSE delivery took 264ms in the integration test.
- The browser test verifies immediate update dispatch and opening by T+300ms even when another update arrives at T+200ms. The same test fails against the previous 2s debounce.
- All 17 focused release, source-freshness, PDF, preparation, stream and browser checks pass.
- `tsc --noEmit --incremental false` passed.
- Independent code review found no actionable issues. Headline priority is retained within each shorter batch; a later batch cannot preempt a card already open.

## Existing suite failures

The full source suite ran 236 tests: 226 passed and 10 failed. The same ten failures reproduced in an isolated source copy with the latency implementation restored to its previous version. Unrelated existing local edits were retained in that comparison.

| File | Failing test |
| --- | --- |
| `src/ingest/boe-dmp-release.test.ts` | business release polling reads the exact own-price three-month average from the workbook |
| `src/lib/dashboard-calendar-metrics.test.ts` | release diary omits chart-only metric series |
| `src/lib/dashboard-calendar-metrics.test.ts` | UK retail diary shows both published MoM series exactly once |
| `src/lib/economic-calendar-view.test.ts` | Eurostat calendar labels a scheduled GDP flash estimate and clears it on final release |
| `src/lib/expectation-chart-groups.test.ts` | model-based and UK professional expectations use the requested paired axes |
| `src/lib/nyfed-expectation-axes.test.mjs` | NY Fed comparison charts assign series to intentional axes |
| `src/lib/release-driver-adapters.test.ts` | CPI driver histories use six exact months and never include aggregate parents |
| `src/lib/release-driver-adapters.test.ts` | PCE estimates monthly component effects from prior-month BEA expenditure shares |
| `src/lib/release-notifications.test.ts` | late component arrivals do not reopen a card; separate cards stay queued |
| `src/lib/uk-retail.test.ts` | rollover to next month still retries the whole previous retail release family |

The next live release is still needed to measure actual publication-to-screen latency. Source response time, database time and scheduled-to-commit time are logged separately; an upstream provider publishing or responding late can still exceed 2–3 seconds.
