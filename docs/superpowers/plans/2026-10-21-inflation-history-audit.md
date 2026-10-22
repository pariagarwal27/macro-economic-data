# Inflation History Audit and Backfill Plan

> **For agentic workers:** Native execution in the current task; complete each step in order.

**Goal:** Verify and correct the official-source historical inflation series used for the US, UK, and Euro Area price sections, including headline/core/component YoY, MoM, and valid 3m/3m annualized values.

**Architecture:** Treat the metric catalog and source adapters as the inventory, compare every stored series against its originating BLS, BEA, ONS, or Eurostat series, then backfill official observations and validate derived rates from the correct underlying indexes. Preserve source-defined gaps and keep incompatible measures (expectations and wage costs) out of the consumer/producer price scope.

**Tech Stack:** TypeScript/Next.js, SQLite/libSQL, official BLS/BEA/ONS/Eurostat APIs and published data.

**Spec:** User request in this conversation.

## Global Constraints

- Use only official statistical agency sources for price observations.
- Preserve each agency's published frequency, seasonal adjustment, definitions, and genuine missing periods.
- Derive 3m/3m SAAR only from compatible seasonally adjusted monthly price indexes; use official published short-term rates where appropriate.
- Do not substitute estimates for unavailable official observations.
- Do not alter survey inflation expectations or wage-cost measures in this consumer/producer price pass.

## Review Focus

- A stored vendor/fallback value can differ from a revised official series; compare full overlapping histories, not only latest values.
- Published YoY/MoM values may not use the same adjustment basis; match the official definition and index before deriving.
- Uneven or changing component histories must retain their official start dates and missing months.
- Database vintages can hide stale values when querying only latest rows; inspect vintage behavior before replacement.
- Dataset identifiers may resolve to another geography, adjustment, or component; verify IDs against agency metadata.

---

### Task 1: Scope, inventory, and diagnosis

**Files:** `src/catalog/metrics.ts`, `src/catalog/hierarchy.ts`, `src/ingest/source-registry.ts`, `src/ingest/pipeline.ts`, database observations.

- [ ] Enumerate consumer prices, producer prices, underlying/trimmed measures, and all linked components by country; exclude survey expectations and labor costs.
- [ ] Report per metric the official series ID, transform, provider, stored source/vintage, row count, date range, gaps, and duplicate/latest-vintage behavior.
- [ ] Trace each metric through source mapping, fetch adapter, transform, upsert, and UI history reads.

### Task 2: Official-source comparison and corrections

**Files:** `src/catalog/metrics.ts`, source adapter files as needed.

- [ ] Verify catalog IDs and adjustment/definition against official agency metadata and release tables.
- [ ] Compare full database history against official upstream series for each metric, identifying concrete mismatches and missing spans.
- [ ] Correct only proven wrong mappings or transformation rules; document unavailable or non-comparable official series.

### Task 3: Official historical backfill

**Files:** `src/ingest/source-registry.ts`, `src/ingest/pipeline.ts`, focused backfill script if needed, database.

- [ ] Backfill each corrected or incomplete series directly from its official source.
- [ ] Rebuild derived YoY/MoM using the metric's stated basis and derive 3m/3m SAAR only from seasonally adjusted monthly indexes.
- [ ] Keep official unavailability as gaps and record source provenance.

### Task 4: End-to-end audit

**Files:** dashboard/history readers and inflation calculations as needed.

- [ ] Re-query every scoped metric for date coverage and values after backfill.
- [ ] Compare recent release values and a sample of historical values to official releases/data APIs.
- [ ] Confirm the dashboard reads corrected latest series and derived values; report metrics with legitimate non-comparable or unavailable rates.
