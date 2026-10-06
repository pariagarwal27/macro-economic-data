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
