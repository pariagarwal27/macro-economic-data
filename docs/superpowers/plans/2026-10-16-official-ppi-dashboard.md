# Official PPI Dashboard Implementation Plan

> **For agentic workers:** Use the native task-by-task execution approach. Steps use checkbox syntax.

**Goal:** Add official-source US, UK, and Euro Area PPI headline/component YoY and MoM views, ten-year history, release-day refresh, and official next-release dates.

**Architecture:** Extend the existing metric catalog and official-source adapters, using the existing ingestion/store/detail APIs for historical and live observations. Add a PPI-specific comparison mode to the country inflation view and extend the official calendar mappings so a country’s single PPI publication refreshes all its measures without duplicate calendar entries.

**Tech Stack:** TypeScript, Next.js/React, SQLite/libSQL Drizzle, BLS API, ONS time-series CSV/API, Eurostat JSON-stat API, existing calendar workers and node:test scripts.

**Spec:** `docs/superpowers/specs/2026-10-16-producer-price-inflation-design.md`

## Global Constraints

- Use BLS, ONS, and Eurostat only for PPI observations, history, and scheduled release dates.
- Display the agencies’ named major PPI groupings; do not invent a cross-country core PPI.
- Show ten full years of monthly observations, with the additional baseline required for YoY.
- Calculate YoY and MoM from official agency series only; use BLS SA series, Eurostat published monthly changes, and label ONS PPI monthly changes as NSA because its official series are not seasonally adjusted.
- Keep release polling scoped to the officially scheduled release day.
- Preserve all pre-existing working-tree changes; do not overwrite unrelated files, fixtures, or database contents.

## Review Focus

- Missing or revised official series: fail clearly and leave the metric unavailable rather than silently substituting another provider.
- Eurostat dimension/filter mismatches: validate that every request returns the intended geo, market, adjustment, unit, and NACE/MIG category.
- ONS retired/paused/corrected series: derive mappings from the current dataset and reject stale mappings.
- Missing official SA component: display MoM unavailable rather than deriving it from NSA data.
- Shared release event: dispatch every component but render one event per country publication.

---

### Task 1: Lock official PPI series catalog and source routes

**Files:**
- Modify: `src/catalog/metrics.ts`
- Modify: `src/catalog/live-map.ts`
- Modify: `src/ingest/source-registry.ts`
- Test: new PPI catalog/source routing test under `scripts/`

**Interfaces:**
- Catalog entries are monthly metric definitions; rate variants link to an official index series and source transformation metadata.
- Each source route remains provider-specific: `bls`, `ons`, or `eurostat`.

- [ ] Test that every required country/category/measure has a unique catalog ID, an official provider, and a non-empty official source identifier.
- [ ] Verify exact BLS FD–ID IDs, current ONS PPI dataset series IDs/URIs, and Eurostat dimension codes against the official sources cited in the spec; encode only verified major groups.
- [ ] Add the selected major-group index entries and paired YoY/MoM variants. Mark official adjustment status and seasonal series IDs explicitly.
- [ ] Route every entry to its agency adapter; remove or bypass any PPI LSEG/FRED fallback route.
- [ ] Run the focused catalog/routing test and confirm it fails before implementation and passes after.

### Task 2: Add official PPI transformations and historical ingestion

**Files:**
- Modify: `src/ingest/transforms.ts`
- Modify: `src/ingest/pipeline.ts`
- Modify: `src/ingest/bls.ts`, `src/ingest/ons.ts`, and `src/ingest/eurostat.ts` only where provider dimensions/series support requires it
- Test: new PPI transform/backfill tests under `scripts/`

**Interfaces:**
- Reuse existing `RawPoint` and canonical metric persistence.
- Provide one tested PPI rate preparation path consumed by backfill, latest refresh, and release refresh.

- [ ] Test index-to-rate calculations: YoY uses t-12 NSA; MoM uses prior-month official SA; missing baseline/SA leaves a null result.
- [ ] Test each provider fetches the correct country/component and returns monthly observations without silently flattening a non-selected Eurostat dimension.
- [ ] Implement verified mappings and transforms with explicit seasonality handling.
- [ ] Backfill the latest 120 complete observations plus the YoY baseline using only official provider APIs; preserve current release/vintage conventions.
- [ ] Run per-provider sample requests, validate their source identifiers and periods, then run the focused transformation/backfill tests.

### Task 3: Add PPI inflation view to country dashboards

**Files:**
- Modify: `src/components/CountryDashboard.tsx`
- Modify: `src/components/macro-ui-hierarchy.ts`
- Modify: `src/app/editorial.css` and/or `src/app/globals.css` only for the PPI view styling
- Test: component-level or existing dashboard test for PPI tab/data grouping

**Interfaces:**
- PPI remains in category `inflation`, subcategory `producer_prices`.
- Use the existing selected-country props, detail payload map, chart component, and `onOpen` detail callback.

- [ ] Test PPI tab is available for US, UK, and EA, filters rows by country, and its YoY/MoM toggle selects the matching rate IDs.
- [ ] Add a PPI tab next to the existing CPI/PCE and Underlying Inflation views where the country dashboard supports them.
- [ ] Render official country-specific groups in the current CPI/PCE comparison style, with latest-value table, source/period/release metadata, historical chart, and detail navigation.
- [ ] Verify unavailable MoM values render as an em dash and do not break chart axes or release highlighting.

### Task 4: Wire official release calendars and release-day dispatch

**Files:**
- Modify: `Economic_calendar/fetch_bls_calendar.py` or the current BLS calendar module discovered during implementation
- Modify: `Economic_calendar/fetch_ons_calendar.py`
- Modify: `Economic_calendar/fetch_eurostat_calendar.py`
- Modify: `src/ingest/release-dispatcher.ts`
- Modify: calendar metric family/visibility mapping
- Test: release calendar and dispatcher tests

**Interfaces:**
- One official schedule row per country PPI publication, mapped to the full set of that country’s PPI metric IDs.
- Reuse the existing day-scoped release retry and idempotent dispatch logic.

- [ ] Test official calendar parsers produce the next PPI publication date/time and source URL for each region, or an explicit unscheduled state.
- [ ] Test one event triggers all PPI measures for its country while calendar output shows one publication row rather than duplicate rows per component/rate.
- [ ] Extend the shared-release mapping and day-scoped dispatcher to include all PPI component IDs.
- [ ] Verify scheduled-day polling only; verify no additional PPI requests are dispatched on non-release days.
- [ ] Refresh the checked-in calendar snapshot using official source fetchers only, and validate PPI dates and IDs.

### Task 5: End-to-end verification and dashboard review

**Files:**
- Modify: relevant fallback/API metric fixtures only if required by established dashboard behavior
- Test: provider integration tests and existing build/lint/test suite

- [ ] Verify each country’s headline and every registered major group has ten-year YoY history, and MoM wherever an official SA series exists.
- [ ] Run API-level tests for selected country, latest values, observation periods, source labels, and next release dates.
- [ ] Run existing calendar/release tests, focused PPI tests, lint, and production build.
- [ ] Inspect the country dashboard visually at desktop and narrow widths; fix any overlap before completion.
- [ ] Report source/API failures or officially unavailable component measures explicitly; never fabricate values or dates.
