"""Evaluate leakage and feature-complexity fixes for the NFP surprise LightGBM.

The source SQLite database is opened read-only. Feature pruning is performed
inside each expanding-origin fit using that fit's training rows only. Model and
forecast-shrink settings are selected on validation rows; the historical test
period is scored only after those choices are frozen.
"""
from __future__ import annotations

import json
import math
import sqlite3
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
import train_surprise_midas_ensemble as legacy


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / 'data/databases/nfp_new.sqlite3'
OUT = ROOT / f'results/lightgbm_failure_fixes_{date.today():%Y-%m-%d}'
CORRELATION_LIMIT = 0.90
MIN_OBSERVATION_FRACTION = 0.20


def add_calendar_features(data: pd.DataFrame) -> pd.DataFrame:
    """Represent month-of-year smoothly without manually defined month flags."""
    result = data.copy()
    month = pd.PeriodIndex(result.target_month, freq='M').month.to_numpy(dtype=float)
    angle = 2.0 * np.pi * (month - 1.0) / 12.0
    result['calendar_month_sin'] = np.sin(angle)
    result['calendar_month_cos'] = np.cos(angle)
    return result


def feature_rank(training: pd.DataFrame, feature: str, target: pd.Series,
                 minimum_observations: int) -> tuple[float, int]:
    pair = pd.DataFrame({'feature': pd.to_numeric(training[feature], errors='coerce'),
                         'target': target}, index=training.index).dropna()
    if len(pair) < minimum_observations or pair.feature.nunique() < 2:
        return float('nan'), len(pair)
    value = pair.feature.corr(pair.target, method='spearman')
    return (abs(float(value)) if pd.notna(value) else float('nan'), len(pair))


def prune_correlated_features(training: pd.DataFrame, candidates: list[str],
                              target: pd.Series) -> tuple[list[str], list[dict]]:
    """Keep the strongest training-only representative from each high-correlation group."""
    minimum_observations = max(12, math.ceil(len(training) * MIN_OBSERVATION_FRACTION))
    matrix = training[candidates].apply(pd.to_numeric, errors='coerce')
    target_column = '__training_surprise__'
    joined = matrix.join(target.rename(target_column))
    correlation = joined.corr(method='spearman', min_periods=minimum_observations)
    pair_counts = matrix.notna().mul(target.notna(), axis=0).sum(axis=0)
    ranked = []
    diagnostics = []
    for feature in candidates:
        value = correlation.at[feature, target_column]
        count = int(pair_counts[feature])
        strength = abs(float(value)) if pd.notna(value) else float('nan')
        diagnostics.append({'feature': feature, 'target_rank_correlation': strength,
                            'target_pair_count': count, 'minimum_pair_count': minimum_observations})
        if np.isfinite(strength):
            ranked.append((strength, feature))
    ranked.sort(key=lambda item: (-item[0], item[1]))

    selected: list[str] = []
    selected_for = {}
    for _, feature in ranked:
        redundant_with = None
        for chosen in selected:
            association = correlation.at[feature, chosen]
            if pd.notna(association) and abs(float(association)) >= CORRELATION_LIMIT:
                redundant_with = chosen
                break
        if redundant_with is None:
            selected.append(feature)
            selected_for[feature] = feature
        else:
            selected_for[feature] = redundant_with
    for row in diagnostics:
        row['selected'] = row['feature'] in selected
        row['representative'] = selected_for.get(row['feature'])
    if not selected:
        raise ValueError('Training-only feature pruning removed every predictor')
    return selected, diagnostics


def replay(data: pd.DataFrame, candidates: list[str], origin: int, config: dict,
           prune: bool, feature_cache: dict | None = None) -> tuple[float, float, list[str], list[dict]]:
    eligible = compact.training_indices(data, origin, config['window'])
    training = data.loc[eligible]
    if len(training) < 24:
        raise ValueError('Insufficient earlier released outcomes')
    target = training.target_actual.astype(float) - training.current_consensus.astype(float)
    if prune and feature_cache is not None and (config['window'], origin) in feature_cache:
        features, selection = feature_cache[(config['window'], origin)]
    elif prune:
        features, selection = prune_correlated_features(training, candidates, target)
    else:
        features = [f for f in candidates if training[f].notna().any() and training[f].nunique(dropna=True) > 1]
        selection = []
    if not features:
        raise ValueError(f'No usable predictors for origin {data.at[origin, "target_month"]}')
    model = legacy.make_lgb(config)
    model.fit(training[features].astype(float), target)
    surprise = float(model.predict(data.loc[[origin], features].astype(float))[0])
    level = float(data.at[origin, 'current_consensus'] + surprise)
    return level, surprise, features, selection


def metrics(actual, forecast) -> dict:
    y, p = np.asarray(actual, dtype=float), np.asarray(forecast, dtype=float)
    error = p - y
    return {
        'months': int(len(y)),
        'mae': float(np.mean(np.abs(error))),
        'rmse': float(np.sqrt(np.mean(error ** 2))),
        'bias': float(np.mean(error)),
        'max_abs_error': float(np.max(np.abs(error))),
        'direction_accuracy_pct': float(100.0 * np.mean(np.sign(p) == np.sign(y))),
    }


def best_shrink(actual_surprise, predicted_surprise) -> tuple[float, float]:
    """Minimize validation absolute error over [0, 1] using all exact breakpoints."""
    actual = np.asarray(actual_surprise, dtype=float)
    predicted = np.asarray(predicted_surprise, dtype=float)
    candidates = [0.0, 1.0]
    valid = np.isfinite(actual) & np.isfinite(predicted) & (predicted != 0)
    candidates.extend((actual[valid] / predicted[valid]).tolist())
    candidates = sorted({min(1.0, max(0.0, float(x))) for x in candidates if np.isfinite(x)})
    scores = [(float(np.mean(np.abs(actual - shrink * predicted))), shrink)
              for shrink in candidates]
    score, shrink = min(scores, key=lambda item: (item[0], item[1]))
    return shrink, score


def run_variant(data: pd.DataFrame, candidates: list[str], val_ids: list[int],
                test_ids: list[int], *, prune: bool, name: str) -> dict:
    searches = []
    validation_by_config = {}
    feature_cache = {}
    if prune:
        for window in sorted({config['window'] for config in legacy.LGB_GRID}):
            for origin in val_ids + test_ids:
                training = data.loc[compact.training_indices(data, origin, window)]
                target = training.target_actual.astype(float) - training.current_consensus.astype(float)
                feature_cache[(window, origin)] = prune_correlated_features(training, candidates, target)
    for number, config in enumerate(legacy.LGB_GRID, start=1):
        rows = [replay(data, candidates, origin, config, prune, feature_cache) for origin in val_ids]
        levels = np.array([row[0] for row in rows], dtype=float)
        surprises = np.array([row[1] for row in rows], dtype=float)
        raw_score = metrics(data.loc[val_ids, 'target_actual'], levels)
        searches.append({'variant': name, 'configuration': json.dumps(config, sort_keys=True),
                         **raw_score})
        validation_by_config[json.dumps(config, sort_keys=True)] = (config, levels, surprises)
        print(f'{name}: validation configuration {number}/{len(legacy.LGB_GRID)} complete', flush=True)

    selected_row = min(searches, key=lambda row: (row['mae'], row['configuration']))
    selected_key = selected_row['configuration']
    config, val_levels, val_surprises = validation_by_config[selected_key]
    consensus_val = data.loc[val_ids, 'current_consensus'].astype(float).to_numpy()
    actual_val = data.loc[val_ids, 'target_actual'].astype(float).to_numpy()
    val_actual_surprise = actual_val - consensus_val
    shrink, _ = best_shrink(val_actual_surprise, val_surprises)
    test_rows = [replay(data, candidates, origin, config, prune, feature_cache) for origin in test_ids]
    test_surprises = np.array([row[1] for row in test_rows], dtype=float)
    test_raw_levels = data.loc[test_ids, 'current_consensus'].astype(float).to_numpy() + test_surprises
    test_levels = data.loc[test_ids, 'current_consensus'].astype(float).to_numpy() + shrink * test_surprises
    selected_features = [row[2] for row in test_rows]
    feature_selection = []
    for origin, row in zip(test_ids, test_rows):
        for detail in row[3]:
            feature_selection.append({'target_month': data.at[origin, 'target_month'], **detail})

    val_shrunk = consensus_val + shrink * val_surprises
    return {
        'name': name,
        'configuration': config,
        'shrink': shrink,
        'validation_raw': metrics(actual_val, val_levels),
        'validation_shrunk': metrics(actual_val, val_shrunk),
        'test_forecast': test_levels,
        'test_raw_forecast': test_raw_levels,
        'test_surprise': test_surprises,
        'test_metrics': metrics(data.loc[test_ids, 'target_actual'], test_levels),
        'test_raw_metrics': metrics(data.loc[test_ids, 'target_actual'], test_raw_levels),
        'feature_count_test_mean': float(np.mean([len(x) for x in selected_features])),
        'feature_count_test_min': int(min(len(x) for x in selected_features)),
        'feature_count_test_max': int(max(len(x) for x in selected_features)),
        'feature_selection': feature_selection,
        'search': searches,
    }


def main() -> None:
    if OUT.exists():
        raise FileExistsError(f'Refusing to overwrite {OUT}; choose a fresh dated output path.')
    source_hash = base.hash_file(DATABASE)
    with sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True) as connection:
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', connection)
        predictors, _ = base.classify_columns(raw)
        data, source_checks, masks, audit_hashes = compact.build_inputs(connection, raw)
    data = legacy.add_surprise_index(legacy.add_regime(data))
    data = add_calendar_features(data)

    original_features = predictors + legacy.REGIME + ['surprise_lag_1', 'surprise_index_3m']
    no_indeed_features = [feature for feature in original_features
                           if not feature.lower().startswith('indeed_')]
    seasonal_features = no_indeed_features + ['calendar_month_sin', 'calendar_month_cos']
    splits = base.split_masks(data)
    val_ids = data.index[splits['validation']].tolist()
    test_ids = data.index[splits['test']].tolist()

    # The first row reproduces the old all-column specification for comparison.
    # Revised variants prune on each training window and cannot see Indeed history.
    legacy_variant = run_variant(data, original_features, val_ids, test_ids,
                                 prune=False, name='legacy_all_features_raw')
    reduced_variant = run_variant(data, no_indeed_features, val_ids, test_ids,
                                  prune=True, name='revised_no_indeed_pruned')
    seasonal_variant = run_variant(data, seasonal_features, val_ids, test_ids,
                                   prune=True, name='revised_no_indeed_pruned_seasonal')

    actual = data.loc[test_ids, 'target_actual'].astype(float).to_numpy()
    consensus = data.loc[test_ids, 'current_consensus'].astype(float).to_numpy()
    test_forecasts = data.loc[test_ids, ['target_month', 'release_date', 'target_actual', 'current_consensus']].copy()
    test_forecasts.rename(columns={'target_actual': 'actual', 'current_consensus': 'consensus'}, inplace=True)
    for result in [legacy_variant, reduced_variant, seasonal_variant]:
        test_forecasts[f'{result["name"]}_forecast'] = result['test_forecast']
        test_forecasts[f'{result["name"]}_error'] = result['test_forecast'] - actual
        test_forecasts[f'{result["name"]}_absolute_error'] = np.abs(result['test_forecast'] - actual)
        test_forecasts[f'{result["name"]}_raw_forecast'] = result['test_raw_forecast']
        test_forecasts[f'{result["name"]}_raw_error'] = result['test_raw_forecast'] - actual
    test_forecasts['consensus_error'] = consensus - actual
    test_forecasts['consensus_absolute_error'] = np.abs(consensus - actual)

    comparison = [{'model': 'consensus', 'selected_validation_shrink': 0.0,
                   'validation_mae': metrics(data.loc[val_ids, 'target_actual'],
                                             data.loc[val_ids, 'current_consensus'])['mae'],
                   'test_mae': metrics(actual, consensus)['mae'],
                   'test_rmse': metrics(actual, consensus)['rmse'],
                   'test_bias': metrics(actual, consensus)['bias'],
                   'test_max_abs_error': metrics(actual, consensus)['max_abs_error'],
                   'test_direction_accuracy_pct': metrics(actual, consensus)['direction_accuracy_pct']}]
    for result in [legacy_variant, reduced_variant, seasonal_variant]:
        comparison.append({
            'model': f'{result["name"]}_raw',
            'selected_validation_shrink': 1.0,
            'validation_mae': result['validation_raw']['mae'],
            'test_mae': result['test_raw_metrics']['mae'],
            'test_rmse': result['test_raw_metrics']['rmse'],
            'test_bias': result['test_raw_metrics']['bias'],
            'test_max_abs_error': result['test_raw_metrics']['max_abs_error'],
            'test_direction_accuracy_pct': result['test_raw_metrics']['direction_accuracy_pct'],
            'mean_features_used': result['feature_count_test_mean'],
            'minimum_features_used': result['feature_count_test_min'],
            'maximum_features_used': result['feature_count_test_max'],
        })
        comparison.append({
            'model': f'{result["name"]}_validation_shrunk',
            'selected_validation_shrink': result['shrink'],
            'validation_mae': result['validation_shrunk']['mae'],
            'validation_raw_mae': result['validation_raw']['mae'],
            'test_mae': result['test_metrics']['mae'],
            'test_rmse': result['test_metrics']['rmse'],
            'test_bias': result['test_metrics']['bias'],
            'test_max_abs_error': result['test_metrics']['max_abs_error'],
            'test_direction_accuracy_pct': result['test_metrics']['direction_accuracy_pct'],
            'mean_features_used': result['feature_count_test_mean'],
            'minimum_features_used': result['feature_count_test_min'],
            'maximum_features_used': result['feature_count_test_max'],
        })
    comparison = pd.DataFrame(comparison)

    # No explicit historical strike, shutdown, weather, or collection-rate feature
    # table is present. We report this from the schema instead of inventing flags.
    event_tokens = ('strike', 'shutdown', 'collection', 'hurricane', 'weather', 'federal', 'school')
    event_columns = [column for column in raw.columns
                     if any(token in column.lower() for token in event_tokens)]
    existing_labor_event_proxies = [column for column in predictors
                                    if 'layoff' in column.lower() or 'separation' in column.lower()]

    OUT.mkdir(parents=True)
    comparison.to_csv(OUT / 'model_comparison.csv', index=False)
    test_forecasts.to_csv(OUT / 'test_forecasts.csv', index=False)
    pd.concat([pd.DataFrame(result['search']) for result in
               [legacy_variant, reduced_variant, seasonal_variant]], ignore_index=True).to_csv(
                   OUT / 'validation_search.csv', index=False)
    pd.concat([pd.DataFrame(result['feature_selection']) for result in
               [reduced_variant, seasonal_variant]], ignore_index=True).to_csv(
                   OUT / 'test_feature_selection.csv', index=False)
    source_checks.to_csv(OUT / 'monthly_source_checks.csv', index=False)
    pd.DataFrame(masks).to_csv(OUT / 'masked_cells.csv', index=False)

    summary = {
        'database': str(DATABASE), 'source_sha256': source_hash,
        'rows': int(len(raw)), 'columns': int(len(raw.columns)),
        'validation_months': int(len(val_ids)), 'test_months': int(len(test_ids)),
        'splits': {key: int(value.sum()) for key, value in splits.items()},
        'legacy_feature_count': int(len(original_features)),
        'indeed_columns_excluded_from_revised_models': [f for f in original_features
                                                        if f.lower().startswith('indeed_')],
        'revised_feature_selection': {
            'method': 'Within each forecast-origin training window, rank features by absolute Spearman association with training-only first-release surprise; retain the stronger representative when two features have absolute Spearman correlation at or above the configured threshold.',
            'correlation_limit': CORRELATION_LIMIT,
            'minimum_pair_observations': f'max(12, ceil(20% of that origin training rows))',
            'calendar_features': ['calendar_month_sin', 'calendar_month_cos'],
            'calendar_encoding': 'Cyclic sine/cosine calculated from target_month; no hand-entered month labels.',
        },
        'shrink_selection': 'For the selected validation LightGBM configuration, choose the MAE-minimizing surprise multiplier in [0,1] from exact absolute-loss breakpoints in validation predictions; no test labels are used.',
        'models': {
            result['name']: {
                'selected_lightgbm': result['configuration'],
                'selected_validation_shrink': result['shrink'],
                'validation_raw': result['validation_raw'],
                'validation_after_shrink': result['validation_shrunk'],
                'test_metrics': result['test_metrics'],
                'test_raw_metrics': result['test_raw_metrics'],
                'mean_features_used': result['feature_count_test_mean'],
                'min_features_used': result['feature_count_test_min'],
                'max_features_used': result['feature_count_test_max'],
            } for result in [legacy_variant, reduced_variant, seasonal_variant]
        },
        'consensus_validation_metrics': metrics(data.loc[val_ids, 'target_actual'],
                                                data.loc[val_ids, 'current_consensus']),
        'consensus_test_metrics': metrics(actual, consensus),
        'event_feature_audit': {
            'direct_event_or_collection_columns_found_by_name': event_columns,
            'existing_labor_event_proxy_columns': existing_labor_event_proxies,
            'decision': 'No strike, shutdown, weather, federal-layoff, school-calendar or survey-collection history was added because the database has no corresponding timestamped point-in-time feature table. Existing numeric source columns remain eligible when they pass the release-date/audit masking already used by the project.',
        },
        'vintage_and_evaluation_caveats': [
            'Revised Indeed fields are excluded from both revised variants. Other source-vintage limitations reported by the existing build_inputs audit remain.',
            'Consensus timing is accepted as supplied by the user; this script does not independently recertify it.',
            'The 2024–2026 test period has already been examined in earlier project work. This is a diagnostic re-evaluation, not an untouched final holdout.',
            'Historical October 2025 is an unusual combined initial-estimate release; its outcome remains in the historical test as stored.',
        ],
        'source_audit_hashes': audit_hashes,
        'masked_cells': int(len(masks)),
    }
    (OUT / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    if base.hash_file(DATABASE) != source_hash:
        raise RuntimeError('The read-only source database changed during the experiment')
    print(json.dumps({'output': str(OUT), 'comparison': comparison.to_dict('records'),
                      'model_settings': summary['models'],
                      'event_feature_audit': summary['event_feature_audit']}, indent=2))


if __name__ == '__main__':
    main()
