# ADP input timing audit (2026-11-13)

## Scope and result

Audited every non-null `adp_*` training observation in `nfp_training` against ADP provider records archived in `source_files`, matched by the ADP reference month (`target_month`). The model has 241 populated current-month ADP rows from 2006-07 through 2026-09; months before coverage are null rather than ADP-filled. For every populated row, the archived ADP publication date is strictly earlier than the BLS NFP release date (241/241); the smallest calendar-day gap is 1. No ADP publication-date-after-or-on-NFP cases were found.

Feature integrity checks against the archived monthly series: current actual 241/241; prior-month actual 239/239 expected after start-up; two-month lag 237/237 expected after start-up; current consensus estimate 240/240 expected after missing estimate; and surprise (actual minus estimate) 240/240. There were zero value mismatches among rows with both values present. Month-start lag rows are unavailable where the source series has not started.

## What this establishes

The ADP values used as current-month actual, current consensus, surprise, and the two historical ADP lags line up with the archived source record and its recorded publication date, and those dates precede the associated NFP release. Recent official ADP material independently confirms the schedule pattern: the October 2026 NER was published Nov. 4, while the November report was scheduled for Dec. 2 at 8:15 a.m. ET ([ADP Nov. 4 release](https://mediacenter.adp.com/2026-11-04-ADP-National-Employment-Report-Private-Sector-Employment-Increased-by-86%2C000-Jobs-in-October)).

## Caveats

This is an **availability-date audit, not a full point-in-time vintage audit**. The database contains seven provider response snapshots, not a preserved native ADP first-release file for each historical month. The provider's `releasedate` metadata and stored `actual` values agree, but the local archive alone cannot prove that all values are immutable first prints or that consensus estimates are the exact estimates known at the model's forecast cutoff. ADP revises some prior observations (its Sep. 30, 2026 report says August was revised from 38k to 36k), so original-release vintages must be separately preserved before treating every historical ADP value as point-in-time-safe ([ADP Sep. 30 release](https://mediacenter.adp.com/2026-09-30-ADP-National-Employment-Report-Private-Sector-Employment-Increased-by-90%2C000-Jobs-in-September)).

Also, this checks ADP only. It does not certify the timing or vintages of claims, ISM, JOLTS, CES hours/temp-help, consensus, strike, or other inputs. No model features were changed by this audit.

## Reproducible detail

Per-month checks are in [`adp_input_timing_audit_2026-11-13.csv`](adp_input_timing_audit_2026-11-13.csv). Source database: `nfp_model/data/databases/nfp_new.sqlite3`.
