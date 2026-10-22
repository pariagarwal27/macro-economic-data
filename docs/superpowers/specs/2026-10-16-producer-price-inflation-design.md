# Producer Price Inflation Design

## Purpose

Add a complete, official-source PPI experience to each country dashboard under **Prices & Inflation → Producer prices (PPI)**. Match the existing CPI/PCE presentation: country-specific headline and major components, YoY and MoM readings, historical charts, latest-release values, and next official release dates.

## Agreed scope

- Countries are United States, United Kingdom, and Euro Area, shown separately in their existing country pages.
- Use only BLS, ONS, and Eurostat for PPI observations, historical data, and future release dates.
- Backfill monthly history for the most recent ten years; retrieve enough extra source history to calculate the first displayed YoY point.
- Show official major published aggregates and component groups, not every individual product/commodity index in the underlying agency databases.
- Include the PPI family in the existing scheduled live-refresh and economic-calendar paths.
- Keep PPI distinct from CPI/HICP and PCE; do not invent a cross-country “core PPI” comparable series.

## Existing project state

The catalog currently contains two US PPI metrics, two UK PPI metrics, and one Euro Area PPI metric. US live routes point to BLS, UK routes point to ONS, and Euro Area has a Eurostat route, but the current set does not meet the requested component, YoY/MoM, history, UI, and calendar coverage. The ONS headline bulletin parser supplies only input/output YoY values. The release-calendar fetchers already contain UK and Euro Area PPI family mappings; these must be verified against the official events and current calendar storage. Preserve unrelated working-tree changes while implementing this feature.

## User experience

Add a **Producer prices (PPI)** tab beside **CPI & PCE** and **Underlying inflation** in Prices & Inflation. It uses the selected country page and follows the established CPI/PCE layout: comparable YoY/MoM toggle, a time-series comparison chart, and a latest readings table with metric, YoY, MoM, release date, observation period, and official source. Selecting a table row opens that measure’s standard detail view. Country-specific labels explain each agency’s PPI grouping rather than implying the categories are equivalent.

### United States — BLS

Present the BLS Final Demand–Intermediate Demand (FD–ID) structure using the official headline and major published groups. Final Demand should include its published total and major goods, services (trade, transportation/warehousing, and other services), and construction groupings where a corresponding BLS series is available. Intermediate Demand should include the published production-flow stages and major goods/services groupings available in the official FD–ID tables. Include the official core final-demand aggregate only with its precise BLS definition (“less foods, energy, and trade services”).

### United Kingdom — ONS

Present Output, Input, Import, and Export PPI, plus the major published product/manufacturing groups available in the current ONS PPI time-series dataset. The source catalog for implementation must be verified against the current ONS dataset metadata so retired, paused, or corrected time series are not registered as live. Keep Services Producer Price Indices separate from goods PPI unless represented as an explicitly labelled adjacent official family.

### Euro Area — Eurostat

Present industrial producer prices with distinct domestic-market and non-domestic-market views, plus the official Main Industrial Groupings: energy, intermediate goods, capital goods, durable consumer goods, and non-durable consumer goods. Add NACE industry breakdowns only where they are published as the selected major groups in the current monthly dataset. State that this is industrial PPI, not a consumer-service price index.

## Data and calculation rules

- BLS observations come from the official BLS PPI series/API and published FD–ID tables; ONS observations come from the current official PPI dataset/API; Euro Area observations come from Eurostat’s official dissemination API.
- Maintain one canonical monthly index series per component and derive the YoY/MoM metric variants from that same official source series when the agency does not publish a rate series directly.
- YoY is calculated from the official index as `100 * (index[t] / index[t-12] - 1)`. MoM uses the agency’s published monthly rate or is calculated from its official index. Do not create a seasonal adjustment locally. BLS MoM uses its official SA WPS index; Eurostat uses its published monthly-change (`PCH_SM`) rates; ONS PPI is officially unadjusted and its MoM is therefore calculated from the official unadjusted monthly index and labeled NSA.
- Preserve official source identifiers, units, frequency, seasonality, and URLs in the metric catalog. Do not use LSEG or FRED as a silent fallback for this PPI family.
- Backfill at least the last 120 complete monthly observations and the extra baseline needed for YoY. Preserve agency revisions by following the existing observation/vintage conventions.
- Component coverage is limited to the official major groups named above and any further top-level groups clearly exposed as part of the current official tables. Do not scrape or register thousands of detailed product codes.

## Release calendar and live refresh

- US: resolve upcoming dates and times from the BLS PPI release schedule/calendar.
- UK: resolve the next Producer Price Inflation publication from the official ONS release API/calendar.
- Euro Area: resolve the next Industrial Producer Prices event from Eurostat’s official Euro-indicators release calendar/feed.
- Store the country release event once per publication and associate it with all PPI measures released together, including both YoY and MoM variants. Calendar rendering should avoid duplicate event rows for every component while the dashboard release processing still refreshes all affected metrics.
- On release day, run the existing day-scoped release polling/retry flow, fetch updated official source series, persist observations and release metadata, and let existing API polling render the new values. No minute-by-minute retries on non-release days.
- If an agency has not announced the next date, show the project’s existing “date unavailable/not announced” state rather than extrapolating a release date.

## Acceptance criteria

1. Each country’s PPI tab displays its official headline and named major component groups, with source-specific terminology.
2. Each registered component has a verified official identifier and official source URL; there are no third-party PPI observation routes or silent fallback routes.
3. Monthly historical points cover ten full years where source coverage exists; YoY calculations have the required 12-month baseline, and MoM uses only an official SA measure or an explicitly unavailable state.
4. The PPI comparison view, table, and detail pages show matching YoY/MoM values for the selected measure and period.
5. Each country shows the next release date only when retrieved from its agency’s official release calendar/API.
6. One release event triggers refresh of every mapped PPI component for that country, while the economic calendar does not display duplicate rows for each component or rate variant.
7. Tests cover official-source mappings, data dimensionality, 10-year backfill calculations, release-day-only dispatch, event de-duplication, and UI country/component filtering.
8. Existing CPI/PCE and unrelated calendar/release behavior remains passing.

## Official source references

- BLS PPI overview and series information: https://www.bls.gov/ppi/overview.htm
- BLS FD–ID structure: https://www.bls.gov/ppi/fd-id/ppi-final-demand-intermediate-demand-indexes.htm
- BLS FD–ID aggregation series IDs: https://www.bls.gov/ppi/fd-id/ppi-final-demand-intermediate-demand-aggregation-indexes-by-title-and-series-id.htm
- BLS PPI release schedule: https://www.bls.gov/schedule/news_release/ppi.htm
- ONS PPI time-series dataset: https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/producerpriceindexstatisticalbulletindataset/current
- ONS PPI input/output/import/export statistics: https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/producerpriceinflationstatistics
- ONS official release API: https://api.beta.ons.gov.uk/v1/search/releases
- Eurostat domestic industrial producer prices monthly dataset: https://ec.europa.eu/eurostat/databrowser/view/sts_inppd_m/default/table?lang=en
- Eurostat industrial producer prices total monthly dataset: https://ec.europa.eu/eurostat/databrowser/view/sts_inpp_m/default/table?lang=en
- Eurostat PPI metadata and industrial group definitions: https://ec.europa.eu/eurostat/cache/metadata/EN/sts_ind_pric_esms_es.htm
- Eurostat euro-indicators release calendar: https://ec.europa.eu/eurostat/news/euro-indicators/release-calendar
