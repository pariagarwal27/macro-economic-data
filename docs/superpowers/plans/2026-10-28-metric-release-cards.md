# Metric release cards implementation plan

Approved design: the conversation's final Design B, with basket/measure switches,
waterfall, ranked grouped tables, weights, current inflation/rate, current effect
and prior change, six chronological bars and a horizontal median marker.

Scope: US headline/core CPI and PCE; UK CPI/CPIH; EA headline/core HICP;
retail-sales cards in US, UK and EA. Work in the supplied checkout and preserve
unrelated data/database changes. No deployments or automatic commits.

Architecture: a shared accessible release-breakdown renderer with small SVG
waterfall and six-month charts. Inflation, PCE and retail adapters consume the
existing metrics and sources. Reuse the application theme and existing dialogs.

Data constraints:
- Rank by absolute effect, falling back to absolute published rate when effects
  are unavailable. Do not label unweighted rates as additive contributions.
- Use six calendar months ending at the selection; preserve missing months and
  calculate the median from available finite observations only.
- Use a shared zero-inclusive history scale across all displayed components.
- Do not classify PCE, retail, UK or EA components using a US CPI mapping.
- US CPI broad mixed aggregates remain mixed; only explicit researched component
  matches receive sticky/flexible labels. Link the classification methodology.
- Do not sum inflation/rate percentages. Total only disjoint displayed effects
  and applicable weights. Retain coverage and residual/source notes.
- Core PCE broad components must not masquerade as an exact core decomposition.

Tasks:
1. Add and verify pure ranking/calendar-history/median/classification helpers.
2. Implement the shared report, waterfall, history column, grouping and totals.
3. Adapt existing inflation/PCE/retail renderers and widen the targeted dialogs;
   remove duplicate KPI sections and reset controls when switching card families.
4. Run focused node tests, TypeScript/lint checks, then inspect the actual dialogs
   where a browser/runtime is available. Record limitations accurately.

Checks: signed offsets, six-month gaps/year boundaries, all-missing data, no
classification leakage across countries, no aggregate/child double counting,
MoM vs YoY units, subtotal inflation blanks, historical weight validity, and
asynchronous updates preserving or safely resetting the selected period.

Progress: shared model, report, adapters, country-dialog integration and standalone
metric-route reuse implemented. Original driver components retained as safe legacy
implementations; consumers use the new release-card modules.

Validation: 15 focused assertions passed before adding route-alias coverage.
All 11 requested country dialogs passed headless Edge checks, including basket and
measure controls, month selection, narrow-screen internal table scrolling, dark
theme and blank inflation summary cells. Official classification links retained.
Full suite: 131/132 passed at the final complete run; existing failure is
`NY Fed comparison charts assign series to intentional axes`.
Full TypeScript check reports six existing errors in audit-release-calendar.ts,
scripts/ingest.ts, ingest/ons.ts and ingest/pipeline.ts, none in changed UI files.

Review: independent read-only review identified the UK including-fuel legacy-ID
filter collision; corrected with regression coverage. A preexisting control-group
YoY bug was also corrected: underlying levels are used rather than copying MoM
or subtracting unrelated category rates. No unresolved important review findings.

Data ruling: PCE and retail use explicit non-additive component-rate views where
the existing feed lacks current expenditure shares/effects. UK/EA inflation is
not assigned US CPI price-stickiness labels. Mapping those official datasets is
a separate ingestion requirement; this change does not fabricate missing data.

Standalone coverage: targeted /metrics aliases reuse the same renderer; unrelated
metrics keep the existing detail page. Browser checks passed for all 11 country
dialogs and 4 representative standalone pages, with no page errors. New/changed
release components and helpers pass scoped ESLint; the full TypeScript result is
unchanged at the six existing errors listed above. `git diff --check` passed.
Final implementation and validation complete; local preview remains on port 3000.
