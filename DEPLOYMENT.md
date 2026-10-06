# Cloudflare deployment

Public URL: https://macro-economy-tracker.macro-economy-tracker.workers.dev

The Next.js application is deployed with OpenNext to Cloudflare Workers. The
existing `DB` binding points to `macro-economy-db` in Cloudflare D1. Tables from
both local SQLite databases live in that durable hosted database:

- `data/macro.db`: 349 metrics, 137,914 observations, and 488 releases at deployment.
- `Economic_calendar/economic_calendar.db`: 352 calendar records and 125 refresh-log records.

The original SQLite files are preserved. Main-data counts matched the existing
remote database, so only the missing calendar tables were imported. The calendar
export is `data/calendar_d1.sql`; do not rerun its initial import against populated
tables without reviewing it.

## Redeploy

Run `npm run deploy` from this directory with the existing Cloudflare login.
Stop local `wrangler dev` / OpenNext preview processes before rebuilding on
Windows, because they can lock `.open-next` files.

## Updates and limits

The Worker has a minute cron trigger. Its scheduled handler invokes the protected
`/api/cron/releases` route directly, using the existing dispatcher, provider
adapters, release processor and atomic D1 writer. Up to two eligible metrics are
checked per tick. Claims, retry cooldown, provider cache and ingestion reports
persist in D1. The PC does not need to be on.

The existing BEA, BLS, Census, FRED and cron credentials were uploaded to encrypted
Worker secret storage with the user's explicit authorization. They are not stored
in these deployment notes. The cron endpoint rejects unauthenticated requests.

Known recent calendar dates receive priority. Once the supplied calendar expires,
a rolling safety sweep checks non-annual metrics in six-hour buckets and annual
metrics in 24-hour buckets. Provider publication delays, retries and queueing mean
this does not promise immediate updates. Public API responses cache for 30 minutes
to limit free-tier database reads; an ingested value can take that long to appear.

Cloud execution chooses official alternatives instead of local LSEG Desktop.
332 catalog metrics have a cloud source mapping, but that number is not a claim
that every source has been verified. Representative BLS, BEA, ONS, Eurostat, FRED
and Census requests returned usable observations in local cloud-mode tests.
17 metrics remain outside this Worker path: two Atlanta BIE PDF series, five
euro-area LSEG inflation-compensation series, and ten browser-based PMI series.
They retain their existing data. The Python weekly calendar refresh has not been
ported; the hosted schedule remains the imported snapshot, with the rolling
safety sweep covering later publications. Local LSEG routing is preserved.

Cloudflare logs on 2026-10-06 reported that the account's free D1 daily row-read
quota was exhausted. Hosted refresh verification is therefore blocked until
00:00 UTC on 2026-10-07 (17:00 PDT on 2026-10-06). Cron registration and actual
trigger delivery were observed, but those invocations failed on database access;
no successful hosted ingestion cycle has yet been verified. The minute trigger
will continue retrying after the quota reset. Free Workers also impose a 10 ms
CPU allowance, so heavier adapters still require runtime verification.

Indexed bounded history queries replace full-history ranking where practical.
If live APIs fail, dashboard/desk/calendar/metric APIs can return a saved snapshot
exported from the original SQLite files. Such responses carry
`X-Macro-Data: saved-snapshot`; country dashboards visibly warn that live updates
are unavailable. The snapshot is saved data, not a successful refresh, and its
calendar can become stale. Regenerate using
`npx tsx scripts/export-dashboard-fallback.ts` before building when needed.

Verification commands:

- `npx tsx scripts/test-cloud-refresh.ts`: routing, claims, cooldown, no duplicate
  writes and atomic rollback on a failed release insert.
- `npx tsx scripts/verify-cloud-providers.ts`: representative real provider calls
  using a disposable database copy, without modifying the original SQLite files.
- `node scripts/verify-deployment.mjs`: public page/API checks, labelled with live
  versus saved-snapshot status; passing these does not prove ingestion success.
- `node scripts/cloud-refresh-ops.mjs run`: authorized manual hosted refresh.
- `node scripts/watch-cloud-schedule.mjs`: observe scheduled invocation results.

No paid plan or add-on was enabled during deployment. Cloudflare Workers and D1
have free usage quotas; excess usage can interrupt service. Hosting does not keep
your laptop running or require the local preview server.
