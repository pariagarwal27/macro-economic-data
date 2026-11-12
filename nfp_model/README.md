# First-release NFP LightGBM model

This folder carries the reproducible revised_no_indeed_pruned model procedure from the NFP forecast project. It predicts first-release monthly NFP change (in thousands) by learning the surprise versus the month's consensus.

## Procedure

- Training labels: first-release NFP change minus same-month consensus.
- Training window: last 120 eligible monthly rows for the current October 2026 fit; the forecasting runner applies the selected configuration's window.
- Per-origin feature selection: rank candidates by absolute Spearman correlation with training-only surprise; for pairs correlated at 0.90 or more, keep the stronger representative.
- Candidate set: the numeric historical predictor families plus regime and surprise-history features; all Indeed retrospective revised fields are excluded.
- LightGBM: depth 2, 4 leaves, 20 minimum samples per leaf, 100 trees, learning rate 0.03.
- Output: current consensus plus the fitted surprise estimate; the October 2026 run used a surprise multiplier of 1.0.
- The original, release-aware command is scripts/forecast_nfp.py. It accepts a timestamped evidence manifest and refuses forecasts when the model registry or input-evidence checks fail.

The SQLite file and source audit inputs under data/ are copied from the first-release model workspace. The revised-macro database is not used.

## Current live status

The copied registry says forecast_allowed: false. Keep this flag unchanged. On its 33-month historical diagnostic test, the model's MAE was 66.79 thousand jobs and consensus MAE was 65.24 thousand. The model did not beat consensus on that test.

The dashboard's current macro database also lacks the ISM manufacturing and services employment sub-index observations used by the model, and it does not supply the model's full row-level publication evidence contract. The dashboard therefore displays a historical diagnostic, not a current monthly forecast. Do not remove the gate to make a number appear.

## Dependencies

Install requirements.txt in the dashboard's Python runtime. The dashboard deployment has not yet been configured to install these packages or run this model. lightgbm is pinned to 4.7.0; other package versions use compatible ranges because the original run did not record a complete Python lockfile.

A live run requires a timezone-aware JSON manifest with target month, scheduled release time, 8:00 p.m. Eastern cutoff, and verified source observations. See scripts/forecast_nfp.py and scripts/nfp_release_pipeline.py for the exact schema and checks.