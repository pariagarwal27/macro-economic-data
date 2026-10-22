# U.S. Three-Month Trend Implementation Plan

> **For agentic workers:** Native execution in this session. Follow the approved design in `docs/superpowers/specs/2026-10-20-us-three-month-trend-design.md` and preserve all unrelated working-tree changes.

**Goal:** Add a historical 3M trend option to supported U.S. metric graphs, using official-source SAAR or moving-average methods mapped per metric.

**Architecture:** Keep source observations as the single persisted truth. Add an explicit U.S. metric-method registry, derive alternate chart series from official raw histories in the metric API, and let the detail chart switch between native and derived views. Use existing source-specific history fetch/backfill flows to fill missing inputs; do not persist derived values.

**Tech Stack:** TypeScript, Next.js route handlers, React client components, existing database/history readers and source ingestors, Recharts.

**Spec:** `docs/superpowers/specs/2026-10-20-us-three-month-trend-design.md`

## Global Constraints

- U.S. metrics first; do not change UK or Euro Area views in this work.
- Audit every U.S. metric that has a historical detail graph and maintain an explicit per-metric method map.
- Do not infer a calculation solely from a metric's category or display name.
- Use only seasonally adjusted inputs for 3m/3m SAAR; do not manufacture seasonal adjustment.
- Preserve gaps; never bridge missing periods or treat missing values as zero.
- Reuse and refresh official raw histories; do not insert derived values into the source observation table or mislabel calculated data as directly published.
- Preserve the user's existing uncommitted work and limit staging/commits to files created for this feature.

## Review Focus

- Official monthly input is revised or seasonal factors are re-estimated: chart must derive from the newest raw history.
- Data contains a missing month/week or an irregular date: output must preserve the gap rather than average across it.
- A rate is already annualized (BEA GDP): do not annualize it a second time.
- A metric is not eligible for smoothing: omit the control and retain the existing graph.
- Metric unit differs from a percent rate (payroll level/change, claims): show the correct unit in axis and tooltip.

---

### Task 1: Audit and register U.S. graph methods

**Files:**
- Create: `src/catalog/us-three-month-methods.ts`
- Read: `src/catalog/metrics.ts`

**Interfaces:**
- Produces: `US_THREE_MONTH_METHODS`, keyed by metric ID, with explicit method, display label, frequency, seasonal basis, source metric IDs, and not-applicable reason where needed.

- [ ] Enumerate all U.S. metric IDs with detail history and classify each as `published-saar`, `saar-3m3m`, `moving-average`, `agency-average`, or `not-applicable`.
- [ ] Map source metric IDs for each derived series; use direct official SA monthly changes/indexes for 3m/3m calculations and official level/change series for averages.
- [ ] Map GDP to its existing BEA QoQ SAAR series. Map weekly initial claims to the source's four-week average convention. Record any unavailable official-history inputs explicitly.
- [ ] Confirm every graphable U.S. metric is represented and that non-U.S. metrics receive no mapping.

### Task 2: Derive and supply complete historical trend data

**Files:**
- Create: `src/lib/us-three-month-trend.ts`
- Modify: `src/app/api/metrics/[id]/route.ts`
- Read/modify source history only where the audit finds gaps: existing US-specific ingestion modules and backfill scripts.

**Interfaces:**
- Consumes: method entry and official observations keyed by source metric ID.
- Produces: a sorted nullable historical series plus the method label and calculation provenance for API consumers.

- [ ] Implement index and monthly-rate 3m/3m SAAR formulas, simple three-observation averages, and mapped agency-specific averages.
- [ ] Validate date cadence and finite inputs; leave nulls where the required contiguous observation window is incomplete.
- [ ] Extend the metric API to load all mapped source histories and return the derived series only for eligible U.S. metric IDs.
- [ ] Audit historical coverage for every mapped source. Reuse official-source pipelines, adding only the missing publisher backfills; include the calculation baseline and report unavailable coverage without a third-party fallback.
- [ ] Confirm refreshes recompute derived history from the latest raw data and do not write derived observations into the database.

### Task 3: Add the 3M trend chart control

**Files:**
- Modify: `src/components/MetricDetail.tsx`
- Modify: `src/components/SeriesChart.tsx`

**Interfaces:**
- Consumes: existing native history plus optional derived history and method metadata from the metric API.
- Produces: chart selection between native published observations and the mapped three-month trend, preserving year-range interaction.

- [ ] Add a compact option to the Published trend section only when the API provides a valid method.
- [ ] Keep native history selected by default; on selection, plot the historical derived series and show its exact method, period, unit, and source-calculation note.
- [ ] Keep current-year analysis, latest value, and release-vs-prior comparison on native published observations.
- [ ] Ensure unsupported and non-U.S. metrics render the existing chart unchanged.
- [ ] Perform focused manual review of CPI SAAR, payroll/JOLTS average, weekly claims agency average, GDP published SAAR, a gap-containing history, and a non-U.S. metric; run the project's production type/build check without running test suites.
