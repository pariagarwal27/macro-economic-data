# Economic Calendar release-time implementation

The calendar pipeline now supports an exact scheduled release timestamp.

## New field

`calendar.next_release_at`

The value is an ISO-8601 datetime with an explicit timezone offset when
the official source provides an exact time.

Examples:

- `2026-09-30T08:30:00-04:00`
- `2026-10-21T07:00:00+01:00`
- `2026-10-01T10:00:00+02:00`

If the official source supplies only a date, `next_release_at` remains NULL.
The pipeline never invents a release time.

## Changed files

- `release_time_utils.py` — shared timestamp parsing/normalization
- `merge_all_calendars.py` — preserves `next_release_at`
- `db/load_calendar_to_db.py` — stores/migrates `next_release_at`
- `db/setup_db.py` — fresh/existing DB schema support
- `db/view_calendar.py` — displays the new field
- `check_all_dates.py` — includes the new field
- `fetch_bea_calendar.py` — parses official BEA schedule times
- `fetch_boe_calendar.py` — parses explicit BoE publication times when present
- `fetch_census_retail_calendar.py` — parses Census schedule times
- `fetch_ecb_calendar.py` — parses ECB statistical-calendar times where supplied
- `fetch_eurostat_calendar.py` — preserves iCalendar DTSTART datetimes
- `fetch_fred_calendar.py` — adds official BLS family release times
- `fetch_nyfed_sce_philly_spf_calendar.py` — parses NY Fed calendar times
- `fetch_ons_calendar.py` — preserves ONS API release datetimes
- `fetch_special_us_macro_calendar_v2.py` — adds official times for families where the source schedule explicitly supports them

`run_full_calendar_refresh.py` does not need to change.

## Important

Some official providers do not publish an exact future release time for
every family. Those records correctly remain NULL rather than receiving
a guessed time.

After installing this version, run from the `Economic_calendar` folder:

    python run_full_calendar_refresh.py

Then verify:

    python db/view_calendar.py

and/or inspect:

    economic_calendar.db

The existing release-date pipeline remains intact.

## Schedule audit and parser corrections (October 2026)

The authoritative dashboard catalog now drives the merge: exactly 349 metric
IDs are retained, including metrics with no announced schedule. Obsolete aliases
are normalized. Daily market series do not receive synthetic release dates.

Corrected parsers isolate the matching event rather than borrowing adjacent
dates or times: Federal Reserve G.17, NY Fed SCE, ECB SAFE, BEA national GDP,
Census retail and M3, S&P PMI, ONS earnings, BoE publications, and ECFIN ESI.
ISM uses the NY Fed's explicitly published indicators calendar when the ISM
website blocks the primary fetch. All timestamps retain source timezone and DST.

The refreshed SQLite database contains 279 metrics with exact timestamps,
10 with confirmed publication deadlines, 34 with dates but no confirmed time, 14 daily market series,
and 12 with no confirmed next date. Missing dates/times are intentionally NULL.
Provider retrieval failures are separately classified as source errors.

The sidebar includes All Metrics and explains missing schedules. The API no
longer supplies a blanket Eurostat time or marks a future event released merely
because the same metric was ingested earlier in the week. Display times use
Europe/London, with both the displayed date and time converted together.

Run the complete refresh from the project root:

    npm run calendar:refresh

This exports the current catalog and loads local API credentials for the Python
fetchers without logging their values. Python dependencies are listed in
requirements.txt. Existing deployments must receive the changed application
code and refreshed economic_calendar.db; local edits do not update Render.

Verification:

    python -X utf8 -m unittest discover -s Economic_calendar -p "test_*calendar*.py"
    npx tsx scripts/test-calendar-view.ts
    npx tsc --noEmit

## Weekly refresh and release completion

Both `npm run dev` and `npm run start:all` start the calendar worker alongside
the web server and data-ingestion worker. A successful calendar refresh is due
again after seven days. The worker checks every minute, catches up at startup
after downtime, retries failures after one hour, and prevents overlapping runs
with an OS-owned SQLite transaction lock in a separate coordination database.
This lock releases automatically on process death, including a restart that
reuses the same PID. Manual `npm run calendar:refresh` uses the same
lock and updates the weekly success timestamp.

Scheduler state lives in `data/calendar-refresh-state.json`. The Render Docker
configuration sets `CALENDAR_DB_PATH=/app/data/economic_calendar.db`, putting
both databases and refresh state on the existing persistent disk. The bundled
calendar seeds this path only when the persistent calendar does not exist.
Docker installs the Python calendar requirements in `/opt/calendar-python`.
An existing deployment needs a rebuilt image to use these changes. A sleeping
or stopped host cannot execute background jobs; missed refreshes run on restart.

Exact timestamps remain in `next_release_at`. Qualified publication deadlines
use `release_deadline_at` and `release_time_kind` (`by` or `before`), and are
converted to UK time with explicit labels. Atlanta and Cleveland policy pages
are fetched again during refresh rather than assuming an old deadline rule.
OECD's published CLI/BCI 12:00 CET rule now supplies two formerly missing times.

`calendar_history` retains earlier scheduled events when the snapshot rolls
forward. Processed dispatches retain `release_id`, linking each completed event
to the exact committed release row. The API handles delayed ingestion across
midnight and preserves completed events in the weekly view. A scheduled event
remains Pending until committed fresh data is available; previous-period data
does not complete a future event. The sidebar polls the API every ten seconds.

Additional verification:

    node scripts/test-calendar-refresh.mjs
    npx tsx scripts/test-calendar-release-flow.ts

The release-flow test uses temporary SQLite databases; it never simulates
economic releases in the real dashboard database.
