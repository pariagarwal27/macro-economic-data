# First-release NFP LightGBM model

This folder carries the reproducible revised_no_indeed_pruned model procedure from the NFP forecast project. It predicts first-release monthly NFP change (in thousands) by learning the surprise versus the month's consensus.

## Procedure

- Training labels: first-release NFP change minus same-month consensus.
- Training window: last 120 eligible monthly rows for the current October 2026 fit; the forecasting runner applies the selected configuration's window.
- Per-origin feature selection: rank candidates by absolute Spearman correlation with training-only surprise; for pairs correlated at 0.90 or more, keep the stronger representative.
- Candidate set: the numeric historical predictor families plus regime and surprise-history features; all Indeed retrospective revised fields are excluded.
- LightGBM: depth 2, 4 leaves, 20 minimum samples per leaf, 100 trees, learning rate 0.03.
- Output: current consensus plus the fitted surprise estimate; the October 2026 run used a surprise multiplier of 1.0.
- The experimental dashboard and guarded Python runner apply the full predicted surprise (multiplier 1.0).
- The original, release-aware command is scripts/forecast_nfp.py. It accepts a timestamped evidence manifest and refuses forecasts when the model registry or input-evidence checks fail.

The SQLite file and source audit inputs under data/ are copied from the first-release model workspace. The revised-macro database is not used.

## Current live status

The copied registry says forecast_allowed: false. Keep this flag unchanged. On its 33-month historical diagnostic test, the model's MAE was 66.79 thousand jobs and consensus MAE was 65.24 thousand. The model did not beat consensus on that test.

The dashboard's current macro database also lacks the ISM manufacturing and services employment sub-index observations used by the model, and it does not supply the model's full row-level publication evidence contract. The dashboard therefore displays a historical diagnostic, not a current monthly forecast. Do not remove the gate to make a number appear.

## Dependencies

Install requirements.txt in the dashboard's Python runtime. The dashboard deployment has not yet been configured to install these packages or run this model. lightgbm is pinned to 4.7.0; other package versions use compatible ranges because the original run did not record a complete Python lockfile.

A live run requires a timezone-aware JSON manifest with target month, scheduled release time, 8:00 p.m. Eastern cutoff, and verified source observations. See scripts/forecast_nfp.py and scripts/nfp_release_pipeline.py for the exact schema and checks.

## Consensus research comparison

Run `python nfp_model/scripts/consensus_research.py` from the repository root to replay the current LightGBM, compact LightGBM and compact Ridge surprise models, fixed consensus blends, a prior-only rolling blend and a rolling median surprise baseline. Results include paired three-month block-bootstrap intervals and are written under `results/consensus_research_2026-11-12/`. The weights and feature sets are research comparisons, not a certified model-selection procedure. The historical database retains the provenance limitations above, and the 2024–2026 period is already inspected; neither a favorable score nor an interval establishes prospective outperformance. The existing live registry and gate remain unchanged. A credible prospective evaluation still needs archived, timestamped consensus and original-vintage feature evidence, including ISM and event data, collected at a consistent cutoff.

## Source capture for point-in-time research

`scripts/point_in_time_archive.py` captures source bytes by SHA-256 and records an observation with its publication time and actual capture time. It rejects naive timestamps and nonfinite values; snapshot reads verify both record and source hashes and exclude captures after the cutoff. Example: `python nfp_model/scripts/point_in_time_archive.py --archive nfp_model/data/pit_archive --source source.html --observation observation.json`. The JSON requires `feature`, `value`, `reference_month`, `published_at`, and `source_url`. The command uses the current UTC capture time; downloading historical documents today cannot certify historical availability. Capture alone does not verify that a value was correctly extracted or that the publication timestamp is genuine, so records are labeled `source_capture_only` and do not satisfy the live model's verified evidence contract.

For an event signal, the BLS CES strike report (https://www.bls.gov/ces/publications/strike-report.htm) is a potential official source for workers idle during the survey reference period. Its preliminary numbers exclude smaller strikes and may not reflect replacement workers. Capture and verify each report's publication time, reference period and parsed value before using it; absence of a report is missing data, not a zero. Historical pages and the current report cannot by themselves establish their earlier vintages. Automated capture, value verification, consensus snapshots and integration with a frozen prospective forecast remain to be built.
