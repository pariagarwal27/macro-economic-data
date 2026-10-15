# US Underlying Inflation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Underlying inflation tab with five measures sourced exclusively from the Atlanta and Cleveland Feds, live-refreshed on CPI release days and listed individually in the economic calendar.

**Architecture:** Add first-party Atlanta and Cleveland fetchers and parsers, change the five catalog source declarations to their publishers, and route live refresh and historical backfill through those official adapters with no FRED fallback. Extend CPI-dependent schedule/calendar handling to make each metric a separate event, then render the group in the existing Prices & Inflation tab strip and detail cards.

**Tech Stack:** TypeScript, Next.js/React, node:test, xlsx, existing release worker and SQLite/D1 calendar pipeline.

**Spec:** `docs/superpowers/specs/2026-10-15-us-underlying-inflation-design.md`

## Global Constraints

- These five metric IDs use Atlanta Fed or Cleveland Fed as the only data source for live refresh and historical backfill.
- A failed official fetch must remain a retryable source failure; it must never silently persist FRED data.
- Preserve published units, observation periods, and measure definitions.
- Calendar entries share the official US CPI release date and display separately for all five measures.
- Keep the feature inside the current US Prices & Inflation area and preserve existing dashboard styles.

## Review Focus

- Atlanta page or data endpoint changes shape: parser tests cover expected series labels and reject missing series.
- Cleveland workbook/download changes structure: parser tests validate both official files and clear errors for missing columns or invalid files.
- Official source failure causes an accidental FRED fallback: tests assert zero FRED calls and a retryable failure.
- CPI date/time rolls across timezone or DST boundary: schedule tests assert the five rows derive from the BLS CPI timestamp and are not emitted outside the retry window.
- UI labels confuse source or period: render tests assert all five names, official publisher labels, latest observation labels, and tab scope.

---

### Task 1: Official Atlanta and Cleveland readers

**Files:**
- Create `src/ingest/atlanta-sticky-cpi.ts` and `src/ingest/cleveland-cpi-measures.ts`.
- Create `src/ingest/atlanta-sticky-cpi.test.mjs` and `src/ingest/cleveland-cpi-measures.test.mjs`.
- Leave the existing Cleveland model-expectations workbook reader and its separately scoped behavior unchanged.

**Interfaces:**
- Produces history-point arrays compatible with the current `RawPoint` pipeline for each of the five metrics.
- Fetch functions identify their source in returned notes/metadata as Atlanta Fed or Cleveland Fed.

- [x] Write failing tests named `parses all Atlanta 12-month measures`, `rejects an Atlanta response missing a requested series`, `parses Cleveland Median CPI history`, `parses Cleveland Trimmed-Mean CPI history`, and `rejects malformed Cleveland downloads`.
- [x] Run the targeted tests and confirm they fail for the missing official readers or incorrect fallback behavior.
- [x] Implement first-party data discovery/fetch and parsers, validating content types and required series before returning observations.
- [x] Run targeted tests and confirm all five official data readers pass.

### Task 2: Route live and historical ingestion through official publishers

**Files:**
- Modify `src/catalog/metrics.ts`, `src/catalog/live-map.ts`, `src/ingest/pipeline.ts`, `src/lib/live-source-label.ts`, and add/update `src/catalog/cleveland-live-routing.test.mjs` or focused tests for the two new providers.
- The live map adds provider IDs `atlanta_sticky` and `cleveland_cpi`; the pipeline dispatches them to the new official readers.
- Inspect backfill/refresh implementations before changing them; target only the five metric IDs.

**Interfaces:**
- Local and cloud release-worker routing for the five IDs resolves to provider `atlanta_sticky` or `cleveland_cpi`.
- Historical refresh uses the same official readers; FRED is not a fallback for these IDs.

- [ ] Write failing tests named `routes the three Atlanta measures to Atlanta Fed`, `routes the two Cleveland measures to Cleveland Fed`, and `does not call FRED when an official underlying-inflation fetch fails`.
- [ ] Run the targeted routing/ingest tests and verify expected failures.
- [x] Implement provider routing and official-only refresh/backfill; make the official-only source check precede the generic `source === "fred"` backfill path and guard the generic refresh fallback for these five IDs; replace only their history from official observations.
- [ ] Run targeted tests and confirm source notes and stored values retain official provenance.

### Task 3: CPI-day release scheduling and calendar entries

**Files:**
- Modify `src/ingest/cpi-release-schedule.ts`, `src/lib/dashboard-calendar-metrics.ts`, `src/app/api/economic-calendar/route.ts`, and/or `src/lib/economic-calendar-view.ts` to expose derived CPI-linked rows.
- Extend `src/ingest/cpi-release-schedule` and `src/lib/economic-calendar-view.test.ts` coverage.

**Interfaces:**
- Five separate scheduled metric events are derived from each confirmed `us-cpi` release date.
- Calendar actuals are attached to the matching metric event and display each metric's publisher.

- [ ] Write failing tests named `schedules all five underlying CPI measures after the confirmed CPI date`, `calendar shows five separate CPI-dependent underlying measures`, `calendar attaches the matching actual and released status`, and `does not create underlying-measure calendar entries without a CPI schedule`.
- [ ] Run the targeted tests and confirm the current calendar omissions fail.
- [x] Add the five dependent metric IDs to `cpiReleaseCandidates` and `CPI_CALENDAR_DEPENDENT_METRIC_IDS`; include them in `getDashboardCalendarMetrics`; synthesize calendar schedule rows from the BLS CPI schedule where source-specific rows are absent.
- [ ] Run schedule and calendar tests, including a DST-boundary case.

### Task 4: US Inflation tab and five measure cards

**Files:**
- Modify `src/components/CountryDashboard.tsx`, the existing inflation section spec selection/data request, and `src/app/editorial.css` only as needed.
- Add a focused test for the underlying-measures group selection and run `npm run build` to validate the rendered view compiles.

**Interfaces:**
- Existing inflation views remain intact; the new tab selects exactly the five underlying measures.
- Each card shows a trend, latest reading, observation period, and Atlanta Fed/Cleveland Fed source label.

- [ ] Write failing tests named `underlying inflation tab selects exactly the five intended metric IDs` and `existing CPI and PCE tab groups remain unchanged`.
- [ ] Run tests and confirm the new tab is absent before implementation.
- [x] Add the tab and compact cards following the current Prices & Inflation visual system.
- [ ] Run UI tests and verify desktop and narrow viewport behavior.

### Task 5: End-to-end validation

**Files:** Existing release-pipeline validation scripts and any feature-specific integration test.

- [x] Extend `scripts/validate-release-pipeline.ts` to assert the five live providers, official-only source behavior, CPI-linked calendar visibility, and distinct UI metric IDs.
- [ ] Run focused tests with `npx tsx --test <test-path>`, `npm run validate:release-pipeline`, `npm run lint`, and `npm run build`.
- [x] Inspect generated diff to ensure existing unrelated working-tree changes are untouched.
