# Jobless claims input timing audit (2026-11-13)

## Result

Audited the existing initial-claims and continuing-claims feature audits for every training target month (2000-01 through 2026-09). Each feature record lists the contributing weekly observation(s), the independently sourced publication date, the source URL, expected weekly count, and a status.

| Series | Verified feature-month values | NFP months with at least one verified feature | Feature coverage span | Publication timing check |
|---|---:|---:|---|---|
| Initial claims | 2,616 / 2,889 | 310 | 2000-04 to 2026-09 | All 9894 contributor records have publication dates strictly before the NFP release date; zero violations |
| Continuing claims | 2,590 / 2,889 | 289 | 2001-05 to 2026-09 | All 9445 contributor records have publication dates strictly before the NFP release date; zero violations |

Each family has nine audited derived features. For initial claims, these include latest, prior week, weekly change, four-week average/change, month average/prior-month average/change, and reference week. Continuing claims have the analogous nine measures. The archive contains 1,300 independently sourced initial-claims weekly records and 1,256 continuing-claims records, spanning the dates shown in the database; feature audits correctly mark incomplete or unavailable contributor sets as unverified instead of passing them.

## What this means for the model

The audited claims fields are point-in-time eligible for the months/features marked verified: all contributors were published before that month's BLS NFP release, and each feature's contributors match its expected observation count. The training pipeline (`train_compact_nfp_ridge.py`) applies these audits and masks a claims value when its audit is missing, unverified, inconsistent, or contains a contributor dated on/after the NFP release date. Thus the unverified historical cells should not enter the release-aware replay as observed values.

This establishes the audited claims feature values and publication timing from the independent evidence stored in the project. It does not guarantee that every raw provider row is a true first print unless covered by the official evidence audit, nor does it establish predictive improvement or outperformance versus consensus. Claims releases can be revised; this audit relies on the stored contemporaneous publication evidence for the feature contributors.

Month-by-month and feature-by-feature evidence, including source URLs and missing-week reasons, is in [`jobless_claims_input_timing_audit_2026-11-13.csv`](jobless_claims_input_timing_audit_2026-11-13.csv).
