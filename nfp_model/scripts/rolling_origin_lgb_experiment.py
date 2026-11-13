"""Prequential rolling-origin LightGBM settings and consensus-blend experiment.

Every forecast uses the project's release-aware input masks. At
each origin, model family/settings and consensus surprise weight are chosen only
from the previous 24 out-of-sample shadow forecasts. This is a research run;
it does not change the live model or promote a candidate.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
import train_surprise_midas_ensemble as legacy
from train_lightgbm_failure_fixes import prune_correlated_features


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / 'data/databases/nfp_new.sqlite3'
OUT = ROOT / f'results/rolling_origin_lgb_{date.today():%Y-%m-%d}'
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
SHADOW_START = '2014-01'
EVALUATION_START = '2021-01'
HISTORY = 24
MIN_HISTORY = 12

# A small, predeclared grid. Includes the prior selected configuration and
# contrasts only a few tree complexities, round counts, feature sets, windows.
CONFIGS = [
    {'name': 'core_r120_d2_l4_100', 'features': 'core', 'window': 'rolling120',
     'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 20,
     'n_estimators': 100, 'learning_rate': 0.03},
    {'name': 'core_r120_d2_l4_250', 'features': 'core', 'window': 'rolling120',
     'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 20,
     'n_estimators': 250, 'learning_rate': 0.015},
    {'name': 'core_r84_d2_l4_150', 'features': 'core', 'window': 'rolling84',
     'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 15,
     'n_estimators': 150, 'learning_rate': 0.02},
    {'name': 'core_r120_d1_l2_100', 'features': 'core', 'window': 'rolling120',
     'max_depth': 1, 'num_leaves': 2, 'min_child_samples': 30,
     'n_estimators': 100, 'learning_rate': 0.03},
    {'name': 'full_pruned_r120_d2_l4_100', 'features': 'full_pruned', 'window': 'rolling120',
     'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 20,
     'n_estimators': 100, 'learning_rate': 0.03},
    {'name': 'full_pruned_r120_d3_l7_200', 'features': 'full_pruned', 'window': 'rolling120',
     'max_depth': 3, 'num_leaves': 7, 'min_child_samples': 25,
     'n_estimators': 200, 'learning_rate': 0.02},
    {'name': 'full_pruned_exp_d2_l4_100', 'features': 'full_pruned', 'window': 'expanding',
     'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 20,
     'n_estimators': 100, 'learning_rate': 0.03},
]

CORE = [
    'current_consensus', 'previous_nfp', 'previous_surprise',
    'initial_claims_4week_avg', 'initial_claims_4week_change',
    'continuing_claims_4week_avg', 'continuing_claims_4week_change',
    'jolts_openings_change', 'jolts_hires_change',
    'ism_mfg_employment_latest', 'ism_services_employment_latest',
]


def metric_record(actual: np.ndarray, forecast: np.ndarray,
                  consensus: np.ndarray) -> dict:
    error = forecast - actual
    improvement = np.abs(actual - consensus) - np.abs(error)
    return {
        'months': int(len(actual)),
        'mae': float(np.mean(np.abs(error))),
        'rmse': float(np.sqrt(np.mean(error ** 2))),
        'bias_forecast_minus_actual': float(np.mean(error)),
        'mean_mae_improvement_vs_consensus': float(np.mean(improvement)),
        'months_beating_consensus': int(np.sum(improvement > 1e-9)),
        'months_tied_with_consensus': int(np.sum(np.abs(improvement) <= 1e-9)),
    }


def paired_block_interval(actual: np.ndarray, forecast: np.ndarray,
                          consensus: np.ndarray, draws: int = 5000) -> list[float]:
    delta = np.abs(actual - consensus) - np.abs(actual - forecast)
    if not len(delta):
        return [float('nan'), float('nan')]
    rng = np.random.default_rng(20261113)
    block = min(3, len(delta))
    means = np.empty(draws)
    for i in range(draws):
        starts = rng.integers(0, len(delta), size=int(np.ceil(len(delta) / block)))
        indices = np.concatenate([(s + np.arange(block)) % len(delta) for s in starts])[:len(delta)]
        means[i] = delta[indices].mean()
    return [float(x) for x in np.quantile(means, [0.025, 0.975])]


def eligible_indices(data: pd.DataFrame, origin: int, window: str) -> list[int]:
    row = data.loc[origin]
    eligible = (data.target_month < row.target_month) & (data.release_date < row.release_date)
    if window.startswith('rolling'):
        months = int(window.removeprefix('rolling'))
        first_month = str(pd.Period(row.target_month, freq='M') - months)
        eligible &= data.target_month >= first_month
    elif window != 'expanding':
        raise ValueError(f'Unsupported training window: {window}')
    return data.index[eligible].tolist()


def build_shadow_forecasts(data: pd.DataFrame, candidates: list[str]) -> pd.DataFrame:
    core = [feature for feature in CORE if feature in data.columns]
    origins = data.index[data.target_month >= SHADOW_START].tolist()
    rows = []
    all_config_features = {}

    for pos, origin in enumerate(origins, start=1):
        row = data.loc[origin]
        consensus = pd.to_numeric(pd.Series([row.current_consensus]), errors='coerce').iloc[0]
        actual = pd.to_numeric(pd.Series([row.target_actual]), errors='coerce').iloc[0]
        if pd.isna(consensus) or pd.isna(actual):
            continue
        predictions = {}
        for config in CONFIGS:
            eligible = eligible_indices(data, origin, config['window'])
            training = data.loc[eligible]
            training = training.loc[training.target_actual.notna() & training.current_consensus.notna()]
            if len(training) < 60:
                predictions[config['name']] = float('nan')
                continue
            target = training.target_actual.astype(float) - training.current_consensus.astype(float)

            if config['features'] == 'core':
                features = [f for f in core if training[f].notna().any() and training[f].nunique(dropna=True) > 1]
            else:
                cache_key = (config['window'], origin)
                if cache_key not in all_config_features:
                    all_config_features[cache_key] = prune_correlated_features(training, candidates, target)
                features = all_config_features[cache_key][0]

            if not features:
                predictions[config['name']] = float('nan')
                continue
            params = {key: config[key] for key in
                      ['window', 'max_depth', 'num_leaves', 'min_child_samples', 'n_estimators', 'learning_rate']}
            model = legacy.make_lgb(params)
            model.fit(training[features].astype(float), target)
            prediction = float(model.predict(data.loc[[origin], features].astype(float))[0])
            predictions[config['name']] = prediction

        # Robust low-complexity baseline: median of the most recent 12 released
        # consensus surprises in this origin's available training window.
        median_training = data.loc[eligible_indices(data, origin, 'rolling120')]
        median_training = median_training.loc[median_training.target_actual.notna() & median_training.current_consensus.notna()]
        train_surprises = (median_training.target_actual.astype(float) - median_training.current_consensus.astype(float)).dropna()
        predictions['recent_median_surprise_12'] = float(train_surprises.tail(12).median()) if len(train_surprises) else float('nan')
        rows.append({'target_month': row.target_month, 'release_date': row.release_date,
                     'actual': float(actual), 'consensus': float(consensus), **predictions})
        if pos % 12 == 0 or pos == len(origins):
            print(f'Generated shadow forecasts for {pos}/{len(origins)} origins', flush=True)
    return pd.DataFrame(rows)


def add_adaptive_forecast(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    candidates = [config['name'] for config in CONFIGS] + ['recent_median_surprise_12']
    selected_models, selected_weights, forecasts, histories = [], [], [], []
    for i, row in result.iterrows():
        past = result.iloc[:i].tail(HISTORY)
        past = past.loc[past.release_date < row.release_date]
        choices = []
        if len(past) >= MIN_HISTORY:
            for name in candidates:
                prior_surprise = pd.to_numeric(past[name], errors='coerce')
                good = prior_surprise.notna() & past.actual.notna() & past.consensus.notna()
                if good.sum() < MIN_HISTORY:
                    continue
                actual_prior = past.loc[good, 'actual'].to_numpy(float)
                consensus_prior = past.loc[good, 'consensus'].to_numpy(float)
                surprise_prior = prior_surprise.loc[good].to_numpy(float)
                for weight in WEIGHTS:
                    score = float(np.mean(np.abs(actual_prior -
                                                 (consensus_prior + weight * surprise_prior))))
                    # On ties, favor consensus (lower weight), then simpler model
                    # by the order in candidates.
                    choices.append((score, weight, candidates.index(name), name))
        if choices:
            score, weight, _, name = min(choices)
            predicted_surprise = float(row[name])
            forecast = float(row.consensus + weight * predicted_surprise)
            selected_models.append(name)
            selected_weights.append(float(weight))
            histories.append(int(len(past)))
            forecasts.append(forecast)
        else:
            selected_models.append('consensus_warmup')
            selected_weights.append(0.0)
            histories.append(int(len(past)))
            forecasts.append(float(row.consensus))
    result['adaptive_selected_model'] = selected_models
    result['adaptive_selected_weight'] = selected_weights
    result['adaptive_history_months'] = histories
    result['adaptive_forecast'] = forecasts
    return result


def main() -> None:
    if OUT.exists():
        raise FileExistsError(f'Refusing to overwrite existing experiment: {OUT}')
    source_hash = base.hash_file(DATABASE)
    with sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True) as con:
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', con)
        predictors, _ = base.classify_columns(raw)
        data, source_checks, masks, audit_hashes = compact.build_inputs(con, raw)
    data = legacy.add_surprise_index(legacy.add_regime(data))
    candidates = [feature for feature in predictors + legacy.REGIME +
                  ['surprise_lag_1', 'surprise_index_3m'] if not feature.lower().startswith('indeed_')]
    frame = build_shadow_forecasts(data, candidates)
    frame = add_adaptive_forecast(frame)
    frame['consensus_error'] = frame.consensus - frame.actual
    frame['adaptive_error'] = frame.adaptive_forecast - frame.actual
    frame['adaptive_absolute_error'] = frame.adaptive_error.abs()

    reports = {}
    for label, mask in [
        ('rolling_validation_2021_2023', frame.target_month.between('2021-01', '2023-12')),
        ('previously_inspected_diagnostic_2024_onward', frame.target_month >= '2024-01'),
    ]:
        part = frame.loc[mask].copy()
        actual = part.actual.to_numpy(float)
        consensus = part.consensus.to_numpy(float)
        model_columns = [config['name'] for config in CONFIGS] + ['recent_median_surprise_12']
        metrics = {'consensus': metric_record(actual, consensus, consensus), 'candidates': {}}
        for name in model_columns:
            surprise = pd.to_numeric(part[name], errors='coerce').to_numpy(float)
            valid = np.isfinite(surprise)
            forecast = consensus[valid] + surprise[valid]
            metrics['candidates'][name + '_full_surprise'] = {
                **metric_record(actual[valid], forecast, consensus[valid]),
                'paired_block_bootstrap_95pct_mae_improvement_interval': paired_block_interval(
                    actual[valid], forecast, consensus[valid]),
            }
        adaptive = part.adaptive_forecast.to_numpy(float)
        metrics['adaptive_online_model_and_weight'] = {
            **metric_record(actual, adaptive, consensus),
            'paired_block_bootstrap_95pct_mae_improvement_interval': paired_block_interval(actual, adaptive, consensus),
            'selected_models': part.adaptive_selected_model.value_counts().to_dict(),
            'selected_weights': {str(k): int(v) for k, v in part.adaptive_selected_weight.value_counts().sort_index().items()},
            'mean_prior_forecast_history': float(part.adaptive_history_months.mean()),
        }
        reports[label] = metrics

    OUT.mkdir(parents=True)
    frame.to_csv(OUT / 'forecasts.csv', index=False)
    pd.DataFrame(source_checks).to_csv(OUT / 'source_checks.csv', index=False)
    pd.DataFrame(masks).to_csv(OUT / 'masked_cells.csv', index=False)
    (OUT / 'summary.json').write_text(json.dumps({
        'source_sha256': source_hash,
        'experiment': 'Sequential rolling-origin selection of LightGBM settings and consensus surprise weight using the project release-aware input masks. At each origin, select among predeclared candidates using only up to 24 previous out-of-sample shadow forecasts; minimum 12. All candidates forecast every origin from 2014-01 onward, and validation scoring begins 2021-01.',
        'fixed_candidates': CONFIGS,
        'selection': {'history_months': HISTORY, 'minimum_history_months': MIN_HISTORY,
                      'weights': WEIGHTS, 'tie_break': 'smaller surprise weight, then simpler candidate order'},
        'results': reports,
        'source_audit_hashes': audit_hashes,
        'limits': [
            'The 2021–2023 period is rolling validation, not a never-seen holdout. The 2024-onward period has already been inspected in prior project work and is diagnostic only.',
            'ADP release dates and claims features have recent project audits, but historical first-release vintages for every model input and exact consensus cutoff snapshots are not fully certified.',
            'The block-bootstrap intervals summarize this small sample; they do not establish reliable future outperformance.',
            'No forecast model or live setting is promoted by this script.',
        ],
    }, indent=2, default=lambda x: list(x) if isinstance(x, tuple) else x), encoding='utf-8')
    if base.hash_file(DATABASE) != source_hash:
        raise RuntimeError('The read-only source database changed during the experiment')
    print(json.dumps({'output': str(OUT), 'results': reports}, indent=2), flush=True)


if __name__ == '__main__':
    main()
