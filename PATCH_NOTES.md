# MacroHub release-pipeline audit and patch

This archive is a patched copy of the uploaded project. `node_modules`, `.next`,
`.env`, and `.env.local` are intentionally not included; install dependencies
on the target machine and recreate environment variables from `.env.example`.

## What was fixed

1. **Cron release dispatch starvation**
   - The old dispatcher processed only the first 40 due metrics and used
     in-memory attempt tracking. On a release day with >40 due metrics, the
     same first 40 could be selected again every cron invocation.
   - The dispatcher now uses the durable `release_dispatch_state` table,
     claims work persistently, and skips already-processed/recently-claimed
     metrics before filling the per-cycle batch.

2. **Calendar refresh workflow was not actually runnable**
   - The GitHub Actions workflow was nested under `Economic_calendar/.github`.
     GitHub only discovers workflows under the repository root `.github/workflows`.
   - The workflow is now at `.github/workflows/weekly_calendar_refresh.yml`.
   - Its working directory is `Economic_calendar`.
   - A real `Economic_calendar/requirements.txt` was added.
   - Calendar DB/artifacts are explicitly unignored and committed.
   - The workflow passes `FRED_API_KEY` from GitHub Actions secrets.

3. **Calendar loader left stale/incorrect IDs behind**
   - The merge logic preferred BoE provider `id` values over the canonical metric
     ID. This produced rows such as `IAS_Q2A` instead of
     `uk-inflation-exp-1y`.
   - The merge now prefers `metric_id`, then canonical `metric`, then provider `id`.
   - The DB loader rebuilds the canonical calendar table each refresh so obsolete
     IDs do not survive indefinitely.

4. **Calendar coverage gaps**
   - BEA PCE/GDP metrics missing from the calendar fetcher were added.
   - Census retail total/ex-auto mappings were added.
   - ONS UK household consumption was added.
   - Additional FRED release families were added for ECI, housing starts/building
     permits, durable goods, import prices, manufacturers' new orders, Empire
     State, and Employment Situation-derived metrics.
   - A dedicated official ISM + S&P Global PMI calendar fetcher was added.
   - Special-US calendar IDs are normalized to the canonical catalog IDs.

5. **Live source routing bugs**
   - BLS catalog metrics without a LIVE_MAP entry can now use the official BLS API
     cache rather than silently returning no live data.
   - Philadelphia Fed SPF metrics can now be refreshed through the same pipeline
     adapter.
   - Atlanta Fed BIE price expectations and unit-cost expectations are separated;
     the price series no longer receives the unit-cost parser.

6. **Cron/manual endpoint security**
   - Production cron routes now fail closed when `CRON_SECRET` is missing.
   - The old client-side `dev-refresh-secret` was removed from the dashboard.
   - Manual `/api/refresh-data` is development-only.
   - The authenticated `/api/refresh` endpoint no longer accepts secrets in GET
     query strings.

7. **FRED secret exposure**
   - A hard-coded FRED API key was removed from `fetch_fred_calendar.py`.
   - `FRED_API_KEY` must now be supplied through the environment/GitHub secret.

## Verification performed

- TypeScript: `npx tsc --noEmit` — passed.
- Python syntax: `python -m py_compile Economic_calendar/*.py Economic_calendar/db/*.py` — passed.
- ESLint: passed with pre-existing warnings and no errors.
- A full Next.js production build could not be completed in the audit Linux
  environment because the uploaded `node_modules` contains Windows-native
  binaries and the environment could not download the Linux SWC package.
  On the target machine, run `npm install` before `npm run build`.

## Important deployment limitation

The LSEG adapter is a bridge to LSEG Workspace Desktop. It is not a cloud API
embedded in Next.js. For local Windows operation, run the LSEG Python worker
and set:

    LSEG_WORKER_URL=http://127.0.0.1:8787

A Vercel-hosted Next.js function cannot reach a worker running on your personal
PC via `127.0.0.1`. Production therefore needs a reachable/private LSEG worker
service, or those LSEG-backed metrics must be routed to another server-side
official API.

## Important calendar limitation

Some official sources publish a future date but not an exact clock time, and
some publish no future date at all. The patched system does not invent a time.
Date-only releases are polled throughout the release day; metrics with no
announced future date use a lower-frequency safety poll based on their catalog
frequency.

That is different from claiming every metric has a guaranteed exact timestamp.
The exact-time guarantee applies only where the official calendar supplies an
exact timestamp and the deployment cron/worker is running.

## First run

```bash
npm install
copy .env.example .env.local
# Fill in real keys/secrets locally.
npm run db:push
npm run calendar:refresh
npm run backfill
npm run dev
```

For local LSEG release refreshes:

```bash
set LSEG_WORKER_AUTOSTART=1
npm run dev
```

On PowerShell:

```powershell
$env:LSEG_WORKER_AUTOSTART="1"
npm run dev
```
