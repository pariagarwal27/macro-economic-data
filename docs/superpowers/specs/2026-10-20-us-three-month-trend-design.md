# U.S. Three-Month Trend Design

## Purpose

Add a graph option that complements existing YoY, MoM, or native-value views with an official-source three-month trend for U.S. metrics. Depending on the measure, the displayed series is a 3m/3m seasonally adjusted annual rate (SAAR), a three-observation moving average, or an agency-published smoother such as the weekly claims four-week average.

## Agreed scope

- U.S. metrics first; do not change UK or Euro Area views in this work.
- Audit every U.S. metric that has a historical detail graph and maintain an explicit per-metric method map. Do not infer a calculation solely from a metric's category or display name.
- Add the 3M trend control beside the existing graph options only where the metric has a defensible method and enough source history. Give the option a precise label (for example, `3m/3m SAAR`, `3-month average`, or `4-week average`).
- Calculate the full available historical derived series from publisher-sourced observations. Reuse and refresh official raw histories; do not insert derived values into the source observation table or mislabel calculated data as directly published.
- Do not force a three-month transform onto quarterly-only series, irregular survey measures, or series lacking required monthly observations. For quarterly GDP, offer its existing BEA-published quarter-over-quarter SAAR series under a `SAAR` label rather than calculating a duplicate three-month series.

## Existing project state

The metric detail view currently passes the catalog history directly to `SeriesChart`; the chart has no alternate measure selector. The catalog contains many U.S. series with mixed frequencies, sources, units, and transforms. BEA real GDP already uses the official quarterly published-rate series. The project has source-specific ingestion and historical backfill paths, and its database stores source observations by metric/date. The implementation must preserve the user's existing uncommitted work and limit staging/commits to files created for this feature.

## Method mapping and calculations

Create an explicit method registry for U.S. graphable metrics. Each entry records the source metric(s), frequency, seasonal status, displayed method and label, and whether inputs are directly published or derived.

- **Published SAAR:** use the official source's already annualized rate without annualizing it again. This includes BEA quarterly GDP (T10101:1), displayed as `QoQ SAAR` or equivalent.
- **3m/3m SAAR:** where the publisher supplies a seasonally adjusted index or monthly rates suitable for short-run annualization, derive three-month growth compounded to an annual rate. For an index, calculate `100 * ((index[t] / index[t-3])^4 - 1)`. For three consecutive monthly percentage changes, compound the three factors and annualize: `100 * (((1+r[t-2]/100)*(1+r[t-1]/100)*(1+r[t]/100))^4 - 1)`. Only use seasonally adjusted inputs; do not manufacture seasonal adjustment.
- **Three-observation average:** for appropriate monthly levels, rates, or monthly changes where smoothing is more interpretable than annualization, use the current and previous two official observations. Label the quantity/unit accurately (for example, `3-month avg, thousands`).
- **Agency-specific published smoother:** retain the publisher's defined interval when it differs from three monthly observations. For example, initial jobless claims are conventionally presented with a four-week moving average; display that as `4-week average`, not as a 3-month average.
- **Not applicable:** no option for quarterly/irregular metrics without a supported published SAAR or a sound short-run average. Leave the base graph unchanged and document the reason in the method registry.
- Preserve gaps: a derived observation is null if any required input is missing, non-finite, or has a non-consecutive expected period. Do not bridge missing months/weeks or treat missing values as zero.

## Backfill and refresh behavior

- For each mapped metric, verify that official publisher history contains the source series and enough baseline observations for the calculation. Use official publisher APIs/files already integrated where possible; add a source-specific backfill only when coverage is missing.
- Backfill from the earliest contiguous official history available, including at least three preceding observations before the first displayed derived value. A 3m/3m SAAR needs an observation three months before the endpoint; a three-month average needs the current month and previous two. Preserve native weekly/quarterly frequency where relevant.
- Recompute derived values from the latest raw official history when data is refreshed. This automatically reflects official revisions, including BLS seasonal-factor revisions. Derived histories are view transformations and are not persisted as independent observations.
- Keep publisher/source attribution visible in the graph's method note. Describe calculated output as derived from official input data rather than as an agency-published value.
- Do not silently substitute a third-party provider when the official source is unavailable. Show the existing data state and preserve previously stored official observations.

## User experience

- Add a compact measure selector to the metric detail **Published trend** chart. Existing default view and year-range controls remain intact.
- Show `3M trend` only if the metric registry provides a valid method; display the selected method's exact label and unit in the chart subtitle, Y axis, tooltip, and accessibility label.
- Selecting the option plots the full derived history for the same metric and selected year window. The current-year analysis and release-vs-prior table continue to use the publisher's native observation values.
- On U.S. overview/detail charts that expose YoY/MoM or native-period choices for the same metric, expose the same method where the catalog map says it is valid. Do not alter the values for other countries.

## Acceptance criteria

1. Every U.S. metric with a historical graph has an explicit mapped method or a documented not-applicable reason; there are no category-based guesses.
2. A valid mapped metric offers a three-month view beside existing graph options, with a method label matching its actual computation/frequency.
3. 3m/3m SAAR is compounded correctly from official seasonally adjusted inputs; official already-S-A-A-R series are not annualized a second time.
4. Monthly and weekly averages use the exact documented trailing window; gaps are preserved and prevent invalid averages.
5. Historical backfill covers the full contiguous publisher history available and includes required baseline observations; derived values recalculate when raw history is revised.
6. GDP displays its existing BEA-published quarterly SAAR distinctly from the calculated monthly 3m/3m SAAR methods.
7. The graph's original native data, release table, country views, and unrelated metrics remain unchanged.
8. No derived values are persisted as source observations or attributed as directly published by an agency.

## Official method references

- BLS CPI seasonal adjustment, revised seasonally adjusted histories and seasonal-factor updates: https://www.bls.gov/cpi/seasonal-adjustment/
- BLS CPI news release tables and seasonally adjusted index data: https://www.bls.gov/news.release/cpi.htm
- BEA GDP release, quarterly percent changes shown at annual rates: https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026
- BLS CES analytical tables, including comparison of monthly changes with recent averages: https://www.bls.gov/web/empsit.supp.toc.htm
- BLS JOLTS example describing a simple trailing three-month moving average: https://www.bls.gov/jlt/jlt_labstatgraphs_may2010.pdf
- BLS initial claims weekly report and four-week moving-average convention: https://oui.doleta.gov/press/
