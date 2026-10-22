# Euro Area Paired Trend Lines Design

## Goal

Extend the existing Overview charts so Euro Area series show a solid published headline measure and a dotted, explicitly labeled short-term measure, with the published and short-term values aligned in separate tooltip columns. Keep GDP growth unchanged.

## Scope

This change applies to the Overview charts for inflation, retail sales, unemployment, and wage growth. It does not change country dashboard cards, published-reading tables, the economic calendar, or GDP growth. Existing US and UK chart behavior remains intact.

## Data and calculations

The chart will derive trends at display time from the official Eurostat observations already included in the Overview payload. Eurostat does not publish a single comparable three-month measure for all of these series, so labels must describe each series' actual transformation.

| Overview series | Published line | Euro Area dotted line | Method and source |
|---|---|---|---|
| HICP headline and core | Official YoY rate | 3-month average YoY | Arithmetic mean of the current and preceding two consecutive official YoY observations. Label as `3-month avg YoY`; do not call it SAAR because Eurostat HICP is not seasonally adjusted. Use Eurostat HICP monthly rates/indices already fetched by `ea-hicp-yoy`, `ea-core-hicp-yoy`, `ea-hicp-mom`, and `ea-core-hicp-mom` as relevant. |
| Retail sales | YoY change in Eurostat retail trade volume | 3m/3m SAAR | From the seasonally and calendar-adjusted Eurostat monthly volume index, compute `((I_t / I_(t-3))^4 - 1) * 100`. The configured source uses `sts_trtu_m`, total retail trade excluding motor vehicles (`G47`), EA21, seasonal adjustment `SCA`, volume index `I21`. Use original index levels retained on history observations; leave missing when either endpoint is absent or non-positive. |
| Unemployment | Official monthly unemployment rate | 3-month average rate | Arithmetic mean of three consecutive official monthly Euro Area unemployment-rate observations, consistent with the existing US/UK short-term line. The official source is Eurostat `une_rt_m`; the official series is seasonally adjusted. |
| Wages | Official quarterly LCI YoY rate | Official quarterly LCI QoQ rate (three-month period change) | Pair the existing `ea-wage-growth` series with `ea-wage-growth-qoq` from Eurostat `lc_lci_r2_q`. Plot only at quarters where QoQ is observed. Label the dotted line `QoQ (3m/3m)`; do not synthesize monthly observations or call it a three-month average. |

## Presentation

- Solid lines remain the published YoY/rate series; dotted lines use the same region color.
- Overview legends name Euro Area trend measures accurately for each chart.
- Hover tooltips use separate columns for `Published` and `3m3m / avg` (with a more precise dotted-measure heading where needed). A Euro Area value is shown only when that observation exists; absent values remain an em dash.
- The tooltip stays readable and unclipped using the existing Overview tooltip viewport styling.
- Preserve series gaps and quarterly spacing; do not forward-fill or interpolate observations.

## Official references

- [Eurostat HICP data and methodology](https://ec.europa.eu/eurostat/web/hicp/information-data) — HICP data release and available rates; HICP observations are not seasonally adjusted.
- [Eurostat retail trade monthly index](https://ec.europa.eu/eurostat/databrowser/product/page/EI_ISRT_M) — monthly retail index and seasonal-adjustment dimensions.
- [Eurostat monthly unemployment data](https://ec.europa.eu/eurostat/databrowser/view/une_rt_m/default/table?category=labour.employ&lang=en) — official monthly unemployment rate series.
- [Eurostat quarterly labour cost index](https://ec.europa.eu/eurostat/databrowser/product/view/lc_lci_r2_q) — quarterly YoY and QoQ measures.

## Acceptance criteria

1. Euro Area HICP headline and core dotted series are populated from the mean of three consecutive published YoY observations and labeled as a 3-month average.
2. Euro Area retail dotted series is calculated from the seasonally/calendar-adjusted source index with the stated 3m/3m SAAR formula and does not appear where source endpoints are unavailable.
3. Euro Area unemployment dotted series represents a trailing three-month arithmetic mean of the official monthly rate.
4. Euro Area wage dotted points use the official LCI QoQ observations at quarterly dates only.
5. Each affected tooltip separates the published value from the dotted measure; GDP behavior and existing US/UK lines are unchanged.
