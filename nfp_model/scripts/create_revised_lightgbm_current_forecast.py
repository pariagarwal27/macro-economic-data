"""Fit the validation-selected revised NFP LightGBM and append its live forecast."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
import train_surprise_midas_ensemble as legacy
from train_lightgbm_failure_fixes import prune_correlated_features


ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / 'data/databases/nfp_new.sqlite3'
RESULTS = ROOT / 'results/lightgbm_failure_fixes_2026-11-06'
PRIOR_FORECAST = ROOT / 'results/lightgbm_oct_2026_forecast_2026-11-06/lightgbm_inputs.csv'
HISTORICAL_TEST = RESULTS / 'test_forecasts.csv'


def main() -> None:
    summary = json.loads((RESULTS / 'summary.json').read_text(encoding='utf-8'))
    model_summary = summary['models']['revised_no_indeed_pruned']
    config = model_summary['selected_lightgbm']
    shrink = float(model_summary['selected_validation_shrink'])
    source_hash = base.hash_file(DATABASE)

    with sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True) as connection:
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', connection)
        predictors, _ = base.classify_columns(raw)
        data, _, _, _ = compact.build_inputs(connection, raw)
    data = legacy.add_surprise_index(legacy.add_regime(data))
    features = [feature for feature in predictors + legacy.REGIME + ['surprise_lag_1', 'surprise_index_3m']
                if not feature.lower().startswith('indeed_')]

    live_values = pd.read_csv(PRIOR_FORECAST).set_index('feature').value
    live_row = {feature: pd.to_numeric(pd.Series([live_values.get(feature, np.nan)]), errors='coerce').iloc[0]
                for feature in features}
    live_row.update({'target_month': '2026-10', 'release_date': '2026-11-06', 'target_actual': np.nan})
    forecast_index = int(data.index.max()) + 1
    data = pd.concat([data, pd.DataFrame([live_row], index=[forecast_index])], axis=0)

    eligible = compact.training_indices(data, forecast_index, config['window'])
    training = data.loc[eligible]
    target = training.target_actual.astype(float) - training.current_consensus.astype(float)
    selected_features, selection_details = prune_correlated_features(training, features, target)
    model = legacy.make_lgb(config)
    model.fit(training[selected_features].astype(float), target)
    predicted_surprise = float(model.predict(data.loc[[forecast_index], selected_features].astype(float))[0])
    consensus = float(data.at[forecast_index, 'current_consensus'])
    forecast = consensus + shrink * predicted_surprise

    historical = pd.read_csv(HISTORICAL_TEST)
    table = historical[['target_month', 'actual', 'consensus', 'revised_no_indeed_pruned_forecast']].copy()
    table.rename(columns={'revised_no_indeed_pruned_forecast': 'lightgbm_forecast'}, inplace=True)
    table['release_status'] = 'First-release actual available'
    table = pd.concat([table, pd.DataFrame([{
        'target_month': '2026-10', 'actual': np.nan, 'consensus': consensus,
        'lightgbm_forecast': forecast,
        'release_status': 'Forecast made before scheduled release; actual not yet available',
    }])], ignore_index=True)
    table.sort_values('target_month', inplace=True)
    table.to_csv(RESULTS / 'forecast_table_2024_through_2026-10.csv', index=False)

    output = {
        'target_month': '2026-10',
        'as_of': '2026-11-06 before 08:30 ET scheduled release',
        'source_database_sha256': source_hash,
        'training_window': config['window'],
        'training_rows': int(len(training)),
        'first_training_month': str(training.target_month.min()),
        'last_training_month': str(training.target_month.max()),
        'selected_lightgbm': config,
        'selected_validation_surprise_multiplier': shrink,
        'candidate_features_after_excluding_indeed': int(len(features)),
        'selected_features_for_october_forecast': int(len(selected_features)),
        'current_consensus_thousands': consensus,
        'predicted_surprise_thousands': predicted_surprise,
        'forecast_thousands': float(forecast),
        'forecast_rounded_thousands': int(round(forecast)),
        'forecast_rounded_jobs': int(round(forecast * 1000)),
        'october_actual': None,
        'feature_selection': 'Training-only correlation pruning; no Indeed revised-vintage fields; no seasonal features because that variant scored worse on the diagnostic test.',
    }
    (RESULTS / 'october_2026_revised_forecast.json').write_text(json.dumps(output, indent=2), encoding='utf-8')
    pd.DataFrame(selection_details).to_csv(RESULTS / 'october_2026_selected_features.csv', index=False)
    if base.hash_file(DATABASE) != source_hash:
        raise RuntimeError('Source database changed during forecast generation')
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    # The legacy value-only CSV path is retained above for reproducibility by
    # explicit imports. Normal CLI use now requires the shared evidence contract.
    from forecast_nfp import main as guarded_main
    guarded_main()
