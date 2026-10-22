# Euro Area Paired Trends Implementation Plan

> **For agentic workers:** This plan is for native, in-session implementation by the current agent.

**Goal:** Show official Euro Area headline readings and their appropriate short-term trend as solid and dotted Overview chart lines, with separate tooltip columns, while leaving GDP and US/UK behavior unchanged.

**Architecture:** Reuse the Euro Area official series already present in the Overview payload. Build Euro Area inflation averages and retail 3m/3m SAAR in the overview data layer; use the existing quarterly LCI QoQ series for wages and existing trailing rate average for unemployment. Update chart legends and tooltip labels at the presentation layer.

**Tech Stack:** TypeScript, React, Recharts, Eurostat series already ingested by the app.

**Spec:** `docs/superpowers/specs/2026-10-21-euro-area-paired-trends-design.md`

## Global Constraints

- GDP remains unchanged.
- Keep official source readings intact; calculate only the secondary dotted trend.
- Never interpolate missing Eurostat observations or treat monthly HICP as seasonally adjusted.
- Do not alter existing US/UK series or unrelated local changes.

## Review Focus

- Missing HICP month: no three-observation average should be produced across a gap.
- Retail index level absent or non-positive: no SAAR value should be emitted.
- Quarterly wage series: QoQ values must align only to their observed quarter and must not be forward-filled into intervening months.
- Euro Area inflation headline and core: each trend must use its matching HICP series.
- Existing chart tooltip: preserve side-by-side published/trend columns and avoid reverting its overflow fix.

---

### Task 1: Add Euro Area inflation trends

**Files:**
- Modify: `src/lib/overview-data.ts`
- Modify: `src/components/InflationOverviewChart.tsx`

**Interfaces:**
- Reuse `OverviewPayload`, `OverviewInflationPoint`, and the existing `INFLATION_SERIES_IDS` mappings.
- Preserve the existing dynamic keys `${series.key}3m3m` consumed by the chart.

- Build Euro Area headline and core dotted series from the arithmetic mean of the current and preceding two consecutive official YoY observations.
- Add both Euro Area dotted lines only in YoY mode; label them `3-month avg YoY` in the legend.
- Keep the tooltip's published and short-term values in distinct columns and display an em dash where the average is unavailable.

### Task 2: Correct Euro Area retail trend

**Files:**
- Modify: `src/lib/overview-data.ts`
- Modify: `src/components/OverviewChart.tsx`

**Interfaces:**
- Reuse `buildOverviewSeries`, `OverviewChartPoint`, and the existing Euro Area retail payload history.

- Compute the dotted series from retained original Eurostat index levels as `((I_t / I_(t-3))^4 - 1) * 100`.
- Require valid index levels at both endpoints and a complete three-month span; otherwise keep the point missing.
- Label the Euro Area legend and tooltip field `3m/3m SAAR`.

### Task 3: Pair Euro Area wage readings and finalize labels

**Files:**
- Modify: `src/lib/overview-data.ts`
- Modify: `src/components/OverviewChart.tsx`

**Interfaces:**
- Reuse the existing `ea-wage-growth` YoY series and `ea-wage-growth-qoq` auxiliary series.
- Keep quarterly observation dates and existing tooltip row layout.

- Build the dotted wage series from official quarterly QoQ observations only.
- Label the Euro Area wage dotted series `QoQ (3m/3m)`.
- Keep the Euro Area unemployment line as its existing official monthly rate plus trailing three-month average.
- Make tooltip column headings distinguish the published series from the trend, retaining region-specific measure names where applicable.

### Task 4: Validate affected chart data and rendering

**Files:**
- Review: `src/lib/overview-data.ts`
- Review: `src/components/OverviewChart.tsx`
- Review: `src/components/InflationOverviewChart.tsx`
- Review: `src/app/editorial.css`

- Run the project's TypeScript/build verification command and resolve errors caused by these edits.
- Inspect the resulting code diff to confirm GDP and US/UK display paths are unchanged and the existing tooltip overflow styling remains in place.
