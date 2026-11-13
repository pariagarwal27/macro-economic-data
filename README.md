# MacroHub — Global Macro Dashboard

MacroHub is a US / UK / Euro Area macroeconomic dashboard built around official statistical sources, a local SQLite/libSQL data layer, historical observations, release history and automatic release reconciliation.

## Product hierarchy

Home → Country → Key Indicators / Inflation / Growth / Jobs → Components → Detail

The home page intentionally contains only the three country choices. Each country page has the four requested tabs. Every displayed metric links to a full Detail page.

## Official source routing

- US: BLS for CPI, employment and labour statistics; BEA for PCE and GDP.
- UK: ONS.
- Euro Area: Eurostat.
- FRED is only retained as a tertiary fallback for mappings that are explicitly verified. US PCE uses BEA as its primary source.

## Automatic updates

The local release and calendar workers fetch updates from official providers and persist observations and releases. The main dashboard and release calendar poll the database-backed API every 10 seconds, so an open dashboard picks up newly persisted releases automatically.

For local continuous operation:

```bash
npm install
npm run dev
```

## Data model

- `metrics`: canonical metric catalog and source mapping
- `observations`: published observations with release/vintage metadata
- `releases`: release-level actual/consensus/prior/revision information
- `calendar_events`: scheduled/released calendar events and metric mappings
- `ingest_runs`: ingestion audit trail
- `source_handles`: optional source reference metadata

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run db:push
npm run backfill
npm run refresh
npm run release:worker
```

The supplied SQLite database is included for local use.

## Official data ingestion

MacroHub uses the originating statistical agency as the primary source for official series:

- United States: BLS for labor/CPI/PPI/JOLTS and BEA for GDP/PCE.
- United Kingdom: ONS for official macroeconomic series, with Bank of England series for the explicitly catalogued BoE surveys.
- Euro Area: Eurostat for HICP, GDP, labor-market and activity series, with ECB series for the explicitly catalogued ECB surveys.

Create `.env` from `.env.example` and set `BEA_API_KEY`. A registered `BLS_API_KEY` is strongly recommended for the BLS API's higher limits. Official-source metrics do not silently fall back to FRED.

### Automatic release refresh requirements

- The calendar workflow lives at `.github/workflows/weekly_calendar_refresh.yml` and refreshes `Economic_calendar/economic_calendar.db` daily. The local calendar worker also refreshes after known publication times, with a one-hour retry backoff. Optional FRED schedules use the GitHub Actions secret `FRED_API_KEY`; agency calendars are fetched independently.
- If LSEG-backed metrics are enabled, the LSEG Desktop bridge must be reachable at `LSEG_WORKER_URL`. On a local Windows machine, run `npm run release:lseg` or set `LSEG_WORKER_AUTOSTART=1` before `npm run dev`.

The five euro-area market-based inflation-compensation series retain their LSEG
swap RICs. Their bridge requests daily BID/ASK quotes (midpoint), with the
published last price as fallback, and preserves negative rates. Full history is
requested from 1990 in bounded windows and merged into existing observations.
Run `npm run backfill:ea-market` after the bridge is connected. The local release
worker checks these series every 15 minutes on Brussels weekdays, automatically
backfills empty series, fills missed trading days, and revisits a week of recent
quotes. This is an application polling interval; these market series have no
announced economic-release date or time. Cloud-only deployments still require a
separate authenticated LSEG connection and are not enabled by this local repair.

`npm run release:lseg` uses `LSEG_PYTHON` when supplied, otherwise the isolated
`tmp/lseg-venv` interpreter if present, then the system Python. To recreate the
local environment on Windows, run `py -3.11 -m venv tmp/lseg-venv`, then
`tmp/lseg-venv/Scripts/python.exe -m pip install lseg-data==2.1.1`. Workspace must
be running and signed in with the necessary market-data entitlements.
- Metrics without an announced official future release date are covered by a lower-frequency safety poll; the system does not invent an exact release time.

Useful commands:

```powershell
npm run db:push
npm run backfill -- US
npm run backfill -- UK
npm run backfill -- EA
npm run refresh -- US
npm run refresh -- UK
npm run refresh -- EA
```

A country filter (`US`, `UK`, or `EA`) is supported by the ingestion script. Individual metric filters such as `us-cpi` or `us-pce` are also supported.
