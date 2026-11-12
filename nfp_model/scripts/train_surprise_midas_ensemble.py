"""NFP surprise LightGBM + weekly U-MIDAS + fixed consensus/model ensembles."""
from __future__ import annotations

import itertools
import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import MissingIndicator, SimpleImputer
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import StandardScaler

import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
from nfp_midas import weekly_slots

sys.path.insert(0, str(base.ROOT / '.dependencies'))
import lightgbm as lgb

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'results/surprise_midas_ensemble_2026-11-05'
REGIME = ['regime_payroll_mean3', 'regime_payroll_momentum',
          'regime_initial_claims_pressure', 'regime_claims_both_rising']
MIDAS_CONTROLS = ['current_consensus', 'previous_nfp', 'previous_surprise', 'surprise_index_3m']
LGB_GRID = [
    {'window': w, 'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 20,
     'n_estimators': 100, 'learning_rate': 0.03} for w in ['expanding', 'rolling120']
] + [
    {'window': w, 'max_depth': 3, 'num_leaves': 7, 'min_child_samples': 20,
     'n_estimators': 200, 'learning_rate': 0.02} for w in ['expanding', 'rolling120']
] + [
    {'window': w, 'max_depth': 4, 'num_leaves': 15, 'min_child_samples': 25,
     'n_estimators': 200, 'learning_rate': 0.01} for w in ['expanding', 'rolling120']
]
MIDAS_GRID = [
    {'window': window, 'weeks': weeks, 'alpha': alpha}
    for window, weeks, alpha in itertools.product(['expanding', 'rolling120'], [8, 12], [10., 100., 1000.])
]


def add_regime(data):
    result = data.copy()
    means, momentum = [], []
    for origin in data.index:
        prior = data.loc[compact.training_indices(data, origin, 'expanding')].tail(3).target_actual.astype(float)
        mean = float(prior.mean()) if len(prior) else np.nan
        means.append(mean)
        momentum.append(float(prior.iloc[-1] - mean) if len(prior) else np.nan)
    result[REGIME[0]], result[REGIME[1]] = means, momentum
    avg = pd.to_numeric(result.initial_claims_4week_avg, errors='coerce').replace(0, np.nan)
    result[REGIME[2]] = pd.to_numeric(result.initial_claims_4week_change, errors='coerce') / avg
    valid = result[['initial_claims_4week_change', 'continuing_claims_4week_change']].notna().all(axis=1)
    result[REGIME[3]] = np.where(valid,
        ((result.initial_claims_4week_change > 0) & (result.continuing_claims_4week_change > 0)).astype(float), np.nan)
    return result


def add_surprise_index(data):
    result = data.copy()
    surprises = result.target_actual.astype(float) - pd.to_numeric(result.current_consensus, errors='coerce')
    lag1, index3 = [], []
    for origin in result.index:
        eligible = compact.training_indices(result, origin, 'expanding')
        past = surprises.loc[eligible].dropna()
        lag1.append(float(past.iloc[-1]) if len(past) else np.nan)
        recent = past.tail(3)
        baseline = past.tail(36)
        scale = float(baseline.std(ddof=1)) if len(baseline) >= 12 else np.nan
        index3.append(float(recent.mean() / scale) if len(recent) == 3 and scale and np.isfinite(scale) else np.nan)
    result['surprise_lag_1'] = lag1
    result['surprise_index_3m'] = index3
    return result


def make_lgb(config):
    # All measurement and missingness columns are scaled after training-only imputation.
    prep = FeatureUnion([
        ('values', SimpleImputer(strategy='median', keep_empty_features=True)),
        ('missing', MissingIndicator(features='all')),
    ])
    estimator = lgb.LGBMRegressor(
        objective='regression_l1', num_leaves=config['num_leaves'], max_depth=config['max_depth'],
        min_child_samples=config['min_child_samples'], n_estimators=config['n_estimators'],
        learning_rate=config['learning_rate'], reg_lambda=1.0, max_bin=31, n_jobs=1,
        random_state=42, deterministic=True, force_col_wise=True, verbosity=-1)
    return Pipeline([('features', prep), ('scale', StandardScaler()), ('model', estimator)])


def train_idx(data, origin, window):
    return compact.training_indices(data, origin, window)


def replay_lgb(data, features, origin, config):
    idx = train_idx(data, origin, config['window'])
    training = data.loc[idx]
    if len(training) < 24:
        raise ValueError('Insufficient prior released outcomes')
    model = make_lgb(config)
    # The model learns the surprise (actual minus consensus), not the payroll level.
    y = training.target_actual.astype(float) - training.current_consensus.astype(float)
    model.fit(training[features].astype(float), y)
    surprise_hat = float(model.predict(data.loc[[origin], features].astype(float))[0])
    return float(data.loc[origin, 'current_consensus'] + surprise_hat), surprise_hat


def replay_midas(data, columns, origin, config):
    idx = train_idx(data, origin, config['window'])
    training = data.loc[idx]
    if len(training) < 24:
        raise ValueError('Insufficient prior released outcomes')
    model = base.make_pipeline(config['alpha'])
    model.fit(training[columns].astype(float), training.target_actual.astype(float))
    return float(model.predict(data.loc[[origin], columns].astype(float))[0])


def metrics(y, p):
    y, p = np.asarray(y, float), np.asarray(p, float)
    e = p-y
    return {'months': int(len(y)), 'mae': float(np.mean(np.abs(e))),
            'rmse': float(np.sqrt(np.mean(e**2))), 'bias': float(np.mean(e)),
            'max_abs_error': float(np.max(np.abs(e)))}


def main():
    if OUT.exists():
        raise FileExistsError(f'Refusing to overwrite {OUT}')
    db = ROOT / 'data/databases/nfp_new.sqlite3'
    source_hash = base.hash_file(db)
    with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as con:
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', con)
        predictors, manifest = base.classify_columns(raw)
        data, source_checks, masks, audit_hashes = compact.build_inputs(con, raw)
        weekly_evidence = []
        for table, series in [('official_initial_claims', 'ic'), ('official_continuing_claims', 'cc')]:
            weekly = pd.read_sql_query(f'SELECT * FROM {table} ORDER BY week_ending', con)
            slots, evidence = weekly_slots(data, weekly, series, weeks=12)
            data = pd.concat([data, slots], axis=1)
            weekly_evidence.extend(evidence)
    data = add_surprise_index(add_regime(data))
    lgb_features = predictors + REGIME + ['surprise_lag_1', 'surprise_index_3m']
    splits = base.split_masks(data)
    val_ids, test_ids = data.index[splits['validation']].tolist(), data.index[splits['test']].tolist()

    # Select LGBM surprise settings on validation MAE of the final level forecast.
    lgb_scores, lgb_predictions, selected_lgb = [], {}, None
    for number, config in enumerate(LGB_GRID, start=1):
        pairs = [replay_lgb(data, lgb_features, i, config) for i in val_ids]
        preds = [p[0] for p in pairs]
        score = metrics(data.loc[val_ids, 'target_actual'], preds)
        lgb_scores.append({'configuration': json.dumps(config, sort_keys=True), **score})
        lgb_predictions[config['window'] + json.dumps(config, sort_keys=True)] = preds
        print(f'LightGBM residual validation setting {number}/{len(LGB_GRID)} complete', flush=True)
    best = min(lgb_scores, key=lambda r: (r['mae'], r['configuration']))
    selected_lgb = json.loads(best['configuration'])

    # U-MIDAS learns NFP levels from consensus controls and individual weekly claims lags.
    midas_scores, selected_midas = [], None
    midas_columns_by_config = {}
    for config in MIDAS_GRID:
        columns = MIDAS_CONTROLS + [f'{series}_week_{lag:02d}'
                                    for series in ['ic', 'cc'] for lag in range(1, config['weeks'] + 1)]
        midas_columns_by_config[json.dumps(config, sort_keys=True)] = columns
        preds = [replay_midas(data, columns, i, config) for i in val_ids]
        midas_scores.append({'configuration': json.dumps(config, sort_keys=True),
                             **metrics(data.loc[val_ids, 'target_actual'], preds)})
    best_midas = min(midas_scores, key=lambda r: (r['mae'], r['configuration']))
    selected_midas = json.loads(best_midas['configuration'])
    midas_columns = midas_columns_by_config[best_midas['configuration']]

    # Recreate selected validation forecasts, then replay the held historical test.
    val_residual = [replay_lgb(data, lgb_features, i, selected_lgb) for i in val_ids]
    test_residual = [replay_lgb(data, lgb_features, i, selected_lgb) for i in test_ids]
    val_lgb_level = [p[0] for p in val_residual]
    test_lgb_level = [p[0] for p in test_residual]
    val_midas = [replay_midas(data, midas_columns, i, selected_midas) for i in val_ids]
    test_midas = [replay_midas(data, midas_columns, i, selected_midas) for i in test_ids]
    val_consensus = data.loc[val_ids, 'current_consensus'].astype(float).to_numpy()
    test_consensus = data.loc[test_ids, 'current_consensus'].astype(float).to_numpy()
    val_actual = data.loc[val_ids, 'target_actual'].astype(float).to_numpy()
    test_actual = data.loc[test_ids, 'target_actual'].astype(float).to_numpy()

    def ensembles(consensus, midas, residual):
        matrix = np.column_stack([consensus, midas, residual])
        return {'equal_mean_ensemble': matrix.mean(axis=1), 'median_ensemble': np.median(matrix, axis=1)}
    val_ens = ensembles(val_consensus, val_midas, val_lgb_level)
    test_ens = ensembles(test_consensus, test_midas, test_lgb_level)
    validation_metrics = {
        'consensus': metrics(val_actual, val_consensus),
        'three_release_average': metrics(val_actual, [compact.latest_three_mean(data, i) for i in val_ids]),
        'midas_level': metrics(val_actual, val_midas),
        'lightgbm_consensus_plus_predicted_surprise': metrics(val_actual, val_lgb_level),
        **{k: metrics(val_actual, v) for k, v in val_ens.items()},
    }
    test_metrics = {
        'consensus': metrics(test_actual, test_consensus),
        'three_release_average': metrics(test_actual, [compact.latest_three_mean(data, i) for i in test_ids]),
        'midas_level': metrics(test_actual, test_midas),
        'lightgbm_consensus_plus_predicted_surprise': metrics(test_actual, test_lgb_level),
        'lightgbm_predicted_surprise_only': metrics(
            data.loc[test_ids, 'target_actual'].astype(float).to_numpy()-test_consensus,
            [p[1] for p in test_residual]),
        **{k: metrics(test_actual, v) for k, v in test_ens.items()},
    }

    OUT.mkdir(parents=True)
    pd.DataFrame([{'model': k, **v} for k, v in validation_metrics.items()]).to_csv(OUT/'validation_metrics.csv', index=False)
    pd.DataFrame([{'model': k, **v} for k, v in test_metrics.items()]).to_csv(OUT/'test_metrics.csv', index=False)
    pd.DataFrame(lgb_scores).to_csv(OUT/'lightgbm_validation_search.csv', index=False)
    pd.DataFrame(midas_scores).to_csv(OUT/'midas_validation_search.csv', index=False)
    test_rows = data.loc[test_ids, ['target_month', 'release_date', 'target_actual', 'current_consensus']].copy()
    test_rows.rename(columns={'target_actual': 'actual', 'current_consensus': 'consensus'}, inplace=True)
    test_rows['midas_level_forecast'] = test_midas
    test_rows['predicted_surprise'] = [p[1] for p in test_residual]
    test_rows['residual_model_level_forecast'] = test_lgb_level
    for name, values in test_ens.items():
        test_rows[name] = values
    test_rows['three_release_average'] = [compact.latest_three_mean(data, i) for i in test_ids]
    test_rows.to_csv(OUT/'test_forecasts.csv', index=False)
    pd.DataFrame(weekly_evidence).to_csv(OUT/'weekly_source_audit.csv', index=False)
    source_checks.to_csv(OUT/'monthly_source_checks.csv', index=False)
    pd.DataFrame(masks).to_csv(OUT/'masked_cells.csv', index=False)
    pd.DataFrame({'lightgbm_feature': lgb_features}).to_csv(OUT/'lightgbm_features.csv', index=False)
    summary = {
        'database': str(db), 'source_sha256': source_hash, 'rows': len(raw), 'columns': len(raw.columns),
        'numeric_db_predictors': len(predictors), 'lightgbm_engineered_features': REGIME + ['surprise_lag_1','surprise_index_3m'],
        'selected_lightgbm': selected_lgb, 'selected_midas': selected_midas,
        'midas_controls': MIDAS_CONTROLS, 'midas_weekly_lags': 12,
        'ensemble': 'Predeclared equal-weight mean and median of consensus level, U-MIDAS level, and consensus plus LightGBM-predicted surprise.',
        'splits': {k: int(v.sum()) for k, v in splits.items()},
        'validation_metrics': validation_metrics, 'test_metrics': test_metrics,
        'surprise_definition': 'target_actual minus same-month current_consensus; predicted level = consensus + predicted surprise.',
        'surprise_index_definition': 'Mean of the previous three published first-release surprises divided by the standard deviation of up to 36 prior surprises; at least 12 prior surprises are required for the scale.',
        'weekly_lag_rule': '12 consecutive weekly observations per claims series, selected only when published before the NFP release; missing weeks are preserved.',
        'training_rule': 'Expanding or rolling120; at each origin, only earlier target outcomes published before that release enter training.',
        'historical_caveat': 'Validation and test periods have been examined in earlier experiments; test results are diagnostic, not an untouched holdout.',
        'masked_cells': len(masks), 'source_audit_hashes': audit_hashes,
    }
    (OUT/'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    if base.hash_file(db) != source_hash:
        raise RuntimeError('Source DB changed during run')
    print(json.dumps({'selected_lightgbm': selected_lgb, 'selected_midas': selected_midas,
                      'validation_metrics': validation_metrics, 'test_metrics': test_metrics,
                      'output': str(OUT)}, indent=2))


if __name__ == '__main__':
    main()
