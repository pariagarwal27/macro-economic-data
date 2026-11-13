# Rolling-origin LightGBM experiment (2026-11-13)

## Conclusion

The experiment did **not** establish that the revised forecast beats consensus. The online model/weight selector improved validation MAE by 1.70 thousand jobs, but its 95% paired block-bootstrap interval includes zero. On the previously inspected 2024–September 2026 diagnostic period, it underperformed consensus by 4.90 thousand jobs MAE. No candidate was promoted, and live model settings were not changed.

## Method

- Generated monthly one-step-ahead shadow forecasts from January 2014 through September 2026.
- Compared seven fixed, predeclared candidates varying compact versus training-only-pruned features, 84/120-month versus expanding windows, tree depth/leaves, 100–250 boosting rounds, and learning rate.
- Also included a baseline that adds the trailing 12-release median consensus surprise.
- At each origin, chose candidate and consensus surprise weight from the preceding 24 shadow forecast errors only, requiring at least 12 prior forecasts. Allowed weights were 0, 0.25, 0.5, 0.75, and 1. The zero-weight choice is consensus.
- Scored the 2021–2023 rolling validation period separately from 2024 onward. The latter has already been examined in prior work, so it is diagnostic rather than an untouched holdout.

## Results (MAE, thousand jobs)

| Period | Consensus | Online selected model + weight | Mean MAE improvement vs consensus | 95% paired block-bootstrap interval | Months beating consensus |
|---|---:|---:|---:|---:|---:|
| 2021–2023 validation (36 months) | 146.92 | 145.22 | +1.70 | −9.02 to +13.25 | 15 / 36 |
| 2024–Sep 2026 diagnostic (33 months) | 65.24 | 70.14 | −4.90 | −10.68 to +0.44 | 15 / 33 (3 ties) |

Positive improvement means the candidate’s MAE was lower. Both intervals include zero. The validation selector chose full surprise weight for all 36 months; on the later diagnostic period it selected a mixture of weights but still lost to consensus on average.

The best fixed full-surprise setting on the 2024+ diagnostic slice had MAE 66.52, still above consensus at 65.24; its improvement interval also included zero (−9.17 to +6.21). The previously selected revised LightGBM setting reproduced MAE 66.79 on those same months.

## Interpretation and next step

Changing rounds, window length, feature breadth, and a rolling consensus blend did not produce a reliable consensus win in this experiment. These results do not support increasing the tree count or promoting the adaptive selector. Keep consensus as the fallback and keep the model in shadow evaluation. Freeze future forecasts and consensus snapshots before each NFP release, then compare paired errors as first prints arrive.

The sample is small and the later period has been viewed before. Bootstrap intervals are descriptive, not proof of future performance. Some historical input vintages and consensus cutoff snapshots are still not fully certified, so these historical scores are conditional on the project data.

## Reproducibility

- Script: `nfp_model/scripts/rolling_origin_lgb_experiment.py`
- Per-month forecasts and chosen settings: `forecasts.csv`
- Summary metrics and uncertainty: `summary.json`
- Source checks and masked cells: `source_checks.csv`, `masked_cells.csv`
- Source database SHA-256 is recorded in `summary.json`; script checks the database hash again after the run.

LightGBM's documentation explains the interaction between learning rate, leaves, minimum leaf size, and iterations in its [parameter tuning guide](https://lightgbm.readthedocs.io/en/stable/Parameters-Tuning.html). Forecast selection here uses sequential origins to preserve the order in which outcomes become available; see Hyndman et al.'s [time-series cross-validation example](https://otext.robjhyndman.com/hyndsight/tscvexample/).
