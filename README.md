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

`vercel.json` schedules `/api/cron/releases` every minute. The endpoint uses a durable release-dispatch state table so a large release batch is processed across successive cron invocations without repeatedly reprocessing the same release. The endpoint uses the release calendar table when a mapped release is due and performs a small safety reconciliation when no event is due. The ingestion layer fetches from official providers and persists observations/releases. The main dashboard and release calendar poll the database-backed API every 10 seconds, so an open dashboard picks up newly persisted releases automatically.

For local continuous operation:

```bash
npm install
npm run db:push
npm run release:worker
```

For Vercel, set `BEA_API_KEY` and `CRON_SECRET` in Project Settings. Keep secrets out of source control.

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

The supplied SQLite database is included for development continuity. Production can move the same schema to hosted libSQL/Turso.

## Official data ingestion

MacroHub uses the originating statistical agency as the primary source for official series:

- United States: BLS for labor/CPI/PPI/JOLTS and BEA for GDP/PCE.
- United Kingdom: ONS for official macroeconomic series, with Bank of England series for the explicitly catalogued BoE surveys.
- Euro Area: Eurostat for HICP, GDP, labor-market and activity series, with ECB series for the explicitly catalogued ECB surveys.

Create `.env` from `.env.example` and set `BEA_API_KEY`. A registered `BLS_API_KEY` is strongly recommended for the BLS API's higher limits. Official-source metrics do not silently fall back to FRED.

### Automatic release refresh requirements

- Production must set `CRON_SECRET`; the cron endpoint fails closed when it is missing.
- Production should use the remote LibSQL/Turso database configured by the existing `DATABASE_URL`/`DATABASE_AUTH_TOKEN` settings. A Vercel function cannot use a mutable local SQLite file as a durable production database.
- The weekly calendar workflow lives at `.github/workflows/weekly_calendar_refresh.yml` and refreshes `Economic_calendar/economic_calendar.db`. It requires the GitHub Actions secret `FRED_API_KEY`.
- If LSEG-backed metrics are enabled, the LSEG Desktop bridge must be reachable at `LSEG_WORKER_URL`. On a local Windows machine, run `npm run release:lseg` or set `LSEG_WORKER_AUTOSTART=1` before `npm run dev`.
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
