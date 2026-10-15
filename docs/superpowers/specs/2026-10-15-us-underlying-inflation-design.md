# US Underlying Inflation Measures Design

## Goal

Add a dedicated Underlying inflation tab inside US Prices & Inflation for five measures and ensure both historical and future published readings come directly from the originating Federal Reserve Banks, with the releases visible in the economic calendar.

## Agreed scope

The tab contains:

- Atlanta Fed Sticky CPI
- Atlanta Fed Core Sticky CPI
- Atlanta Fed Flexible CPI
- Cleveland Fed Median CPI
- Cleveland Fed 16% Trimmed-Mean CPI

The new tab belongs beside the current headline CPI, Core CPI, PCE, and Core PCE views within the existing Prices & Inflation area. The dashboard style remains consistent with the current cream background, fine borders, serif headings, and green accents.

## Data-source behavior

- Atlanta series are fetched from the Atlanta Fed's official Sticky-Price CPI data page or its first-party data endpoint linked from that page: https://www.atlantafed.org/research-and-data/data/sticky-price-cpi
- Cleveland series are fetched from the Cleveland Fed's official published data downloads: https://www.clevelandfed.org/indicators-and-data/median-cpi
- Change the five catalog source declarations from `fred` to their originating Fed source, and route them through provider-specific adapters. FRED is not used as a primary source, fallback, or historical backfill source for these five metric IDs. Failures from the official source remain observable/retryable rather than silently switching providers.
- Existing historical observations for these five metric IDs are replaced/refreshed from the corresponding official publisher datasets, preserving each metric's published measure, units, and observation dates. The two Cleveland downloads publish both monthly and 12-month changes; keep the existing catalog definitions' semantics aligned with the selected published YoY series.
- UI source labels identify Atlanta Fed or Cleveland Fed, never FRED.

## Live refresh and release calendar

All five measures update with their respective Fed publisher's CPI-release-day data. The Atlanta Fed states its Sticky-Price CPI page publishes by 11:00 a.m. Eastern on CPI release day. Cleveland's Median CPI page provides the official series downloads and describes calculations from BLS CPI component data; retain the existing Cleveland CPI-dependent release time of 10:00 a.m. Central (11:00 a.m. Eastern). The existing CPI-dependent release scheduling will be extended to all five measures, using the CPI release date and publisher release timing. Each measure is displayed as its own US economic-calendar entry; when a value has been ingested, that row shows the actual value and released status. Calendar entries must not be fabricated on dates without a confirmed CPI release schedule.

## UI behavior

- Add an Underlying inflation tab to the existing US Prices & Inflation metric tab strip.
- Selecting it shows five compact indicator cards with trend history, latest reading, observation month, and official source label.
- Preserve other inflation views and navigation behavior.
- Ensure the five measures are included by the dashboard calendar metric selection.

## Acceptance criteria

1. The five metric IDs each resolve to the correct official Fed provider in local and deployed release-worker routing.
2. No fetch, fallback, or backfill path for those five metric IDs calls FRED.
3. Atlanta parser/fetcher reads Sticky, Core Sticky, and Flexible series with their correct published values and dates; Cleveland parser/fetcher reads both official downloads correctly.
4. Official source errors produce retryable errors, not FRED-sourced observations.
5. Release attempts are scheduled from the CPI event for all five metrics, and future calendar API responses show five separate CPI-linked events with correct source, date/time, values, and status.
6. The five items appear in the new tab with accurate latest data, provenance labels, and existing visual language.
7. Tests cover source routing, data parsing, official-source failure behavior, release candidate creation, calendar rendering, and tab selection.

## Publisher references

- Atlanta Fed Sticky-Price CPI: https://www.atlantafed.org/research-and-data/data/sticky-price-cpi
- Cleveland Fed Median CPI and downloads: https://www.clevelandfed.org/indicators-and-data/median-cpi
- Atlanta Fed release timing: Sticky-Price CPI page states publication by 11:00 a.m. ET on CPI release day.
- Cleveland Fed update context: Median CPI page states its measures are based on the BLS monthly CPI report and provides direct downloads for both series.
