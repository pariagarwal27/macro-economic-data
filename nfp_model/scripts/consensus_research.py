"""Retrospective walk-forward research; results are not certified live forecasts."""
from pathlib import Path
import json
import sqlite3

import numpy as np
import pandas as pd

import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
import train_surprise_midas_ensemble as legacy
from train_lightgbm_failure_fixes import prune_correlated_features

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = (0., .25, .5, .75, 1.)
CORE = ['current_consensus', 'previous_nfp', 'previous_surprise',
        'initial_claims_4week_avg', 'initial_claims_4week_change',
        'continuing_claims_4week_avg', 'continuing_claims_4week_change',
        'jolts_openings_change', 'jolts_hires_change',
        'ism_mfg_employment_latest', 'ism_services_employment_latest']


def rolling_weight(prior, minimum=12):
    """Select a fixed-grid weight exclusively on earlier forecast errors."""
    if len(prior) < minimum:
        return 0.
    return min(WEIGHTS, key=lambda w: (np.mean(np.abs(prior.actual - prior.consensus - w * prior.surprise)), w))


def paired_interval(actual, forecast, consensus, draws=5000):
    """Paired moving-block bootstrap of mean absolute-error improvement."""
    diff = np.abs(actual-consensus) - np.abs(actual-forecast)
    rng = np.random.default_rng(42)
    n, block = len(diff), min(3, len(diff))
    means = []
    for _ in range(draws):
        starts = rng.integers(0, n, size=int(np.ceil(n/block)))
        indices = np.concatenate([(start + np.arange(block)) % n for start in starts])[:n]
        means.append(float(np.mean(diff[indices])))
    return {'mean_improvement': float(np.mean(diff)), 'interval_95': np.quantile(means, [.025, .975]).tolist(),
            'method': 'paired circular moving-block bootstrap; block length 3'}


def main():
    database = ROOT / 'data/databases/nfp_new.sqlite3'
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as con:
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', con)
        predictors, _ = base.classify_columns(raw)
        data, _, _, _ = compact.build_inputs(con, raw)
    data = legacy.add_surprise_index(legacy.add_regime(data))
    candidates = [x for x in predictors + legacy.REGIME + ['surprise_lag_1', 'surprise_index_3m'] if not x.startswith('indeed_')]
    config = {'window': 'rolling120', 'max_depth': 2, 'num_leaves': 4, 'min_child_samples': 20, 'n_estimators': 100, 'learning_rate': .03}
    rows = []
    for origin in data.index[data.target_month >= '2021-01']:
        training = data.loc[compact.training_indices(data, origin, 'rolling120')]
        y = training.target_actual.astype(float) - training.current_consensus.astype(float)
        features, _ = prune_correlated_features(training, candidates, y)
        core = [x for x in CORE if x in data.columns]
        predictions = {}
        for name, cols, estimator in [('lightgbm', features, legacy.make_lgb(config)),
                                      ('compact_lightgbm', core, legacy.make_lgb(config)),
                                      ('compact_ridge', core, base.make_pipeline(1000.))]:
            estimator.fit(training[cols].astype(float), y)
            predictions[name] = float(estimator.predict(data.loc[[origin], cols].astype(float))[0])
        prior_surprises = y.dropna().tail(12)
        row = data.loc[origin]
        rows.append(dict(target_month=row.target_month, release_date=row.release_date, actual=float(row.target_actual), consensus=float(row.current_consensus),
                         median_surprise=float(prior_surprises.median()), **predictions))
    frame = pd.DataFrame(rows)
    for model in ['lightgbm', 'compact_lightgbm', 'compact_ridge']:
        for weight in WEIGHTS:
            frame[f'{model}_w{weight}'] = frame.consensus + weight * frame[model]
        weights = []
        for i in range(len(frame)):
            past = frame.iloc[:i]
            past = past[past.release_date < frame.iloc[i].release_date].copy().rename(columns={model: 'surprise'})
            weights.append(rolling_weight(past))
        frame[f'{model}_rolling_weight'] = weights
        frame[f'{model}_rolling'] = frame.consensus + frame[model] * weights
    frame['median_bias'] = frame.consensus + frame.median_surprise
    output = ROOT / 'results/consensus_research_2026-11-12'
    output.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output / 'walk_forward.csv', index=False)
    reports = {}
    forecast_columns = [x for x in frame if '_w0.' in x or '_w1.' in x or x.endswith('_rolling') or x == 'median_bias']
    for label, selection in [('validation', frame.target_month.between('2021-01', '2023-12')), ('diagnostic', frame.target_month >= '2024-01')]:
        subset = frame[selection]
        actual, consensus = subset.actual.to_numpy(), subset.consensus.to_numpy()
        reports[label] = {'months': len(subset), 'consensus_mae': float(np.mean(np.abs(actual-consensus))), 'models': {}}
        for col in forecast_columns:
            forecast = subset[col].to_numpy()
            reports[label]['models'][col] = {'mae': float(np.mean(np.abs(actual-forecast))),
                'rmse': float(np.sqrt(np.mean((forecast-actual)**2))), 'bias': float(np.mean(forecast-actual)),
                **paired_interval(actual, forecast, consensus)}
    result = {'source_sha256': base.hash_file(database), 'results': reports,
              'limitations': ['Historical source vintages and consensus timing remain conditional.',
                              '2024-2026 has been inspected previously and is not an untouched holdout.',
                              'No candidate is promoted; prospective point-in-time evidence is required.',
                              'Weights and candidate specifications are research comparisons, not independently validated selections.']}
    (output / 'summary.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
