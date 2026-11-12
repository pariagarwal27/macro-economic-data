"""Compact, release-aware monthly Ridge/AR(4) replay. Source database is read-only."""
from __future__ import annotations

import argparse
import html
import json
import sqlite3
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

import train_nfp_ridge as base

LAGS = [f'nfp_lag_{n}' for n in range(1, 5)]
CORE = LAGS + ['initial_claims_4week_avg', 'initial_claims_4week_change',
               'initial_claims_4week_avg_change_12m', 'continuing_claims_4week_avg',
               'continuing_claims_4week_change', 'jolts_openings_change', 'jolts_hires_change',
               'ism_mfg_employment_latest', 'ism_services_employment_latest',
               'ces_aggregate_weekly_hours_change_latest']
WINDOWS = ['expanding', 'rolling120']
LIMITATIONS = [
    'Historical test 2024–2026 has already been examined. This is further historical evaluation, not an untouched test.',
    'Stored target labels are accepted as first-release outcomes; this run does not recertify them against every BLS archive.',
    'Claims/JOLTS cells match existing audits. ISM, hours and ADP cells are source-matched and checked by publication date. '
    'Provider release dates and original-vintage fidelity are not all independently certified; no guaranteed real-time accuracy is claimed.',
    'The ADP sensitivity uses the public provider series, not private payroll microdata. Methodology changed in 2022; no extra regime flag is fitted.',
    'The annual claims feature compares four-week-average forecast snapshots 12 target months apart, not exactly aligned 52-week observations.',
    'Services ISM employment has short history. It cannot influence fits before variation exists in the eligible training data.',
    'All COVID outcomes remain in fitting and evaluation. No COVID deletions, robust-loss selection, or feature search follows test inspection.',
    'Monthly refitting admits earlier validation/test outcomes only after publication. This differs from the previous frozen-parameter experiment.',
    'No unemployment-rate change, CFNAI, month dummies, consensus, Indeed, RPLS or temporary-help predictors are included.',
]


def add_target_lags(data):
    result = data.copy()
    records = data.set_index('target_month')[['target_actual', 'release_date']].to_dict('index')
    for lag in range(1, 5):
        values = []
        for row in data.itertuples():
            previous = records.get(str(pd.Period(row.target_month, freq='M') - lag))
            values.append(previous['target_actual'] if previous and previous['release_date'] < row.release_date else np.nan)
        result[f'nfp_lag_{lag}'] = values
    return result


def training_indices(data, origin, window):
    row = data.loc[origin]
    eligible = (data.target_month < row.target_month) & (data.release_date < row.release_date)
    if window == 'rolling120':
        first_month = str(pd.Period(row.target_month, freq='M') - 120)
        eligible &= data.target_month >= first_month
    elif window != 'expanding':
        raise ValueError(f'Unknown window: {window}')
    return data.index[eligible].tolist()


def latest_three_mean(data, origin):
    indices = training_indices(data, origin, 'expanding')
    return float(data.loc[indices].tail(3).target_actual.mean())


def predict_origin(data, origin, columns, window, kind, alpha, return_model=False):
    indices = training_indices(data, origin, window)
    training = data.loc[indices]
    info = {'target_month': data.loc[origin, 'target_month'], 'window': window, 'alpha': alpha,
            'status': 'model', 'available_outcomes': len(training),
            'first_training_month': training.target_month.min(),
            'last_training_month': training.target_month.max(),
            'latest_training_publication': training.release_date.max()}
    if kind == 'ar4':
        complete = training[columns].notna().all(axis=1)
        training = training.loc[complete]
        if data.loc[origin, columns].isna().any():
            info.update(status='three_release_mean_fallback', fitted_rows=0)
            answer = (latest_three_mean(data, origin), info)
            return (*answer, None) if return_model else answer
        model = LinearRegression()
    elif kind == 'ridge':
        model = base.make_pipeline(alpha)
    else:
        raise ValueError(kind)
    if len(training) < 24:
        raise ValueError('Insufficient eligible historical rows')
    model.fit(training[columns].astype(float), training.target_actual.astype(float))
    forecast = float(model.predict(data.loc[[origin], columns].astype(float))[0])
    info['fitted_rows'] = len(training)
    info['variable_measurement_columns'] = int((training[columns].nunique() > 1).sum())
    return (forecast, info, model) if return_model else (forecast, info)


def replay(data, columns, kind, config, origins):
    rows, ledger, last_model = [], [], None
    for origin in data.index[origins]:
        pred, info, last_model = predict_origin(data, origin, columns, config['window'], kind,
                                                config['alpha'], return_model=True)
        row = data.loc[origin]
        rows.append({'target_month': row.target_month, 'release_date': row.release_date,
                     'actual': float(row.target_actual), 'forecast': pred,
                     'error': pred - row.target_actual, 'absolute_error': abs(pred - row.target_actual),
                     'status': info['status']})
        ledger.append(info)
    return pd.DataFrame(rows), pd.DataFrame(ledger), last_model


def select_configuration(data, columns, kind, validation_mask, alphas=base.ALPHAS, windows=WINDOWS):
    # Only the supplied validation origins are forecast/scored here.
    if (data.loc[validation_mask, 'target_month'] >= '2024-01').any():
        raise ValueError('Test months cannot enter configuration selection')
    candidates = []
    for window in windows:
        for alpha in alphas if kind == 'ridge' else [None]:
            config = {'window': window, 'alpha': alpha}
            predictions, _, _ = replay(data, columns, kind, config, validation_mask)
            candidates.append({**config, **base.score(predictions.actual, predictions.forecast)})
    selected = min(candidates, key=lambda x: (x['mae'], x['window'] != 'expanding', -(x['alpha'] or 0.)))
    return {key: selected[key] for key in ['window', 'alpha']}, candidates


def source_matches(stored, source_value, publication, nfp_release):
    if pd.isna(stored) or source_value is None or not publication:
        return False
    return bool(np.isclose(float(stored), float(source_value), atol=0.011, rtol=1e-7)
                and str(publication)[:10] < nfp_release)


def build_inputs(connection, raw):
    data, events = base.mask_known_unavailable(raw)
    data, other = base.apply_existing_audits(data, connection)
    events.extend(other)
    data = add_target_lags(data)
    source_checks = []
    ism = pd.read_sql_query('SELECT * FROM ism_source_observations', connection)
    ism_map = {(r.series_key, r.reference_month): r for r in ism.itertuples()}
    hours_path = base.ROOT / 'data/databases/ces_hours_backfill_audit.csv'
    hours = pd.read_csv(hours_path).set_index('target_month')
    adp_records = {}
    for source in connection.execute('SELECT sha256, original_bytes FROM source_files'):
        try:
            payload = json.loads(source[1])
        except (ValueError, TypeError):
            continue
        records = payload.get('results', []) if isinstance(payload, dict) else []
        if records and records[0].get('qhcode') == 'US ADP Employment (Change)_1M':
            import hashlib
            blob = source[1].encode() if isinstance(source[1], str) else source[1]
            if hashlib.sha256(blob).hexdigest() != source[0]:
                raise ValueError('ADP source checksum mismatch')
            for record in records:
                month = record['date'][:7]
                if month in adp_records and record != adp_records[month]:
                    raise ValueError('Conflicting archived ADP records')
                adp_records[month] = record
    for index, row in data.iterrows():
        for family, key in [('mfg', 'mfg_employment'), ('services', 'services_employment')]:
            feature = f'ism_{family}_employment_latest'
            source = ism_map.get((key, row[f'ism_{family}_reference_month']))
            value = source.actual if source is not None else None
            publication = source.release_timestamp_raw if source is not None else None
            valid = source_matches(row[feature], value, publication, row.release_date)
            source_checks.append({'target_month': row.target_month, 'feature': feature,
                                  'status': 'matched_provider_source' if valid else 'missing_or_unverified',
                                  'publication': publication})
            if not valid:
                data.at[index, feature] = np.nan
        feature = 'ces_aggregate_weekly_hours_change_latest'
        source = hours.loc[row.target_month] if row.target_month in hours.index else None
        valid = source is not None and source_matches(row[feature], source[feature],
                                                       source.ces_hours_release_date, row.release_date)
        source_checks.append({'target_month': row.target_month, 'feature': feature,
                              'status': 'matched_existing_hours_audit' if valid else 'missing_or_unverified',
                              'publication': source.ces_hours_release_date if source is not None else None})
        if not valid:
            data.at[index, feature] = np.nan
        feature = 'adp_current_change'
        source = adp_records.get(row.target_month, {})
        valid = source_matches(row[feature], source.get('actual'), source.get('releasedate'), row.release_date)
        source_checks.append({'target_month': row.target_month, 'feature': feature,
                              'status': 'matched_provider_source' if valid else 'missing_or_unverified',
                              'publication': source.get('releasedate')})
        if not valid:
            data.at[index, feature] = np.nan
    previous = data.set_index('target_month').initial_claims_4week_avg.to_dict()
    data['initial_claims_4week_avg_change_12m'] = [
        row.initial_claims_4week_avg - previous.get(str(pd.Period(row.target_month, freq='M') - 12), np.nan)
        for row in data.itertuples()]
    return data, pd.DataFrame(source_checks), events, {str(hours_path): base.hash_file(hours_path)}


def write_report(output, summary, metrics, forecasts):
    selected_rows = metrics[metrics.split == 'test'].copy()
    core_mae = float(selected_rows.loc[selected_rows.model == 'compact_ridge', 'mae'].iloc[0])
    ar_mae = float(selected_rows.loc[selected_rows.model == 'ar4', 'mae'].iloc[0])
    mean_mae = float(selected_rows.loc[selected_rows.model == 'three_release_mean', 'mae'].iloc[0])
    interpretation = (f'Core Ridge test MAE: {core_mae:.2f} thousand jobs; AR(4): {ar_mae:.2f}; '
                      f'three-release average: {mean_mae:.2f}. These are observed historical results, '
                      'not a guarantee of future performance. Model settings were selected on validation only.')
    baseline_validation = float(metrics.loc[(metrics.model == 'three_release_mean') &
                                            (metrics.split == 'validation'), 'mae'].iloc[0])
    ridge_validation = metrics.loc[(metrics.model.isin(['compact_ridge', 'compact_ridge_adp'])) &
                                   (metrics.split == 'validation'), 'mae']
    if baseline_validation < ridge_validation.min() and mean_mae < selected_rows.loc[
            selected_rows.model.isin(['compact_ridge', 'compact_ridge_adp']), 'mae'].min():
        interpretation += (' The three-release average beats both Ridge variants on validation and test MAE. '
                           'Neither Ridge variant is promoted as a replacement for that benchmark.')
    settings = pd.DataFrame(summary['selected_settings']).T
    search = pd.read_csv(output / 'validation_search.csv')
    best_per_window = search.sort_values('mae').groupby(['model', 'window']).head(1).sort_values(['model', 'window'])
    warnings = ''.join(f'<li>{html.escape(x)}</li>' for x in LIMITATIONS)
    coverage = pd.read_csv(output / 'feature_coverage.csv')
    doc = f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Compact NFP Ridge and AR(4)</title>
<style>body{{font:16px system-ui,sans-serif;max-width:1400px;margin:36px auto;padding:0 24px;color:#193047}}
h1,h2{{color:#123c57}}table{{border-collapse:collapse;font-size:13px;width:100%;margin:18px 0}}th,td{{padding:8px;text-align:right;border-bottom:1px solid #dbe3eb}}
th:first-child,td:first-child{{text-align:left}}thead{{background:#eaf1f7}}.scroll{{overflow:auto}}.notice{{background:#fff3d6;border-left:5px solid #b17c00;padding:16px}}li{{margin:9px 0}}</style>
<h1>Compact Ridge versus AR(4): historical NFP forecasts</h1>
<p>321 monthly targets, January 2000–September 2026. Units: thousands of jobs. Error = forecast − actual.</p>
<div class="notice">Further historical evaluation: the test period has already been examined in previous project work.</div>
<p>Initial development: 252 months through 2020. Validation: 36 months in 2021–2023. Test: 33 months in 2024–September 2026.
Refit monthly on published outcomes only. Choose expanding or trailing 120 calendar months and Ridge alpha using validation MAE;
freeze these settings before test replay. Target values published on the current NFP release day are excluded from fitting and lag inputs.</p>
<h2>Selected settings</h2>{settings.to_html(border=0)}
<h2>Expanding versus 120-month window: validation only</h2>
<div class="scroll">{best_per_window[['model','window','alpha','mae','rmse','bias']].round(3).to_html(index=False,border=0)}</div>
<h2>Results</h2><p>{html.escape(interpretation)}</p><div class="scroll">{metrics.round(3).to_html(index=False,border=0)}</div>
<h2>Every test forecast</h2><div class="scroll">{forecasts.round(2).to_html(index=False,border=0)}</div>
<p>AR(4) uses complete historical four-lag rows and an intercept. If an origin's calendar lag is unpublished,
the recorded fallback is the mean of the latest three published outcomes. Ridge uses training-only median imputation,
standardization and unscaled missingness flags.</p>
<h2>Core features and coverage</h2><div class="scroll">{coverage.to_html(index=False,border=0)}</div>
<h2>Interpretation limits</h2><ul>{warnings}</ul>
<p><a href="test_forecasts.csv">All test forecasts CSV</a> · <a href="metrics.csv">Metrics</a> ·
<a href="validation_search.csv">All validation settings</a> · <a href="training_ledger.csv">Monthly training ledger</a> ·
<a href="summary.json">Reproducibility details</a></p></html>'''
    (output / 'report.html').write_text(doc, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=base.ROOT / 'data/databases/nfp_new.sqlite3')
    parser.add_argument('--output', type=Path, default=base.ROOT / 'results/compact_ridge_2026-11-05')
    args = parser.parse_args()
    output, database = args.output.resolve(), args.database.resolve()
    if output.exists():
        raise FileExistsError(f'Choose a fresh output directory: {output}')
    source_hash = base.hash_file(database)
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity failed')
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', connection)
        calendar = pd.read_sql_query('SELECT target_month,release_date FROM nfp_release_calendar', connection)
        checked = raw[['target_month', 'release_date']].merge(calendar, on='target_month', validate='one_to_one')
        if len(checked) != len(raw) or not checked.release_date_x.eq(checked.release_date_y).all():
            raise ValueError('Release calendar mismatch')
        if len(raw) != 321 or raw.target_month.duplicated().any() or raw.target_actual.isna().any():
            raise ValueError('Unexpected source target data')
        expected = pd.period_range('2000-01', '2026-09', freq='M').astype(str).tolist()
        if raw.target_month.tolist() != expected:
            raise ValueError('Unexpected monthly timeline')
        data, checks, masks, audit_hashes = build_inputs(connection, raw)
    splits = base.split_masks(data)
    variants = {'compact_ridge': (CORE, 'ridge'), 'compact_ridge_adp': (CORE + ['adp_current_change'], 'ridge'),
                'ar4': (LAGS, 'ar4')}
    selected, searches = {}, []
    # Finish all selection before evaluating ANY test candidate.
    for name, (columns, kind) in variants.items():
        config, candidates = select_configuration(data, columns, kind, splits['validation'])
        selected[name] = config
        searches.extend({'model': name, **item} for item in candidates)
        print(f'Selected on validation: {name}: {config}', flush=True)
    predictions, ledgers, models, metrics = {}, [], {}, []
    for name, (columns, kind) in variants.items():
        for split in ['validation', 'test']:
            forecast, ledger, model = replay(data, columns, kind, selected[name], splits[split])
            metrics.append({'model': name, 'split': split, **base.score(forecast.actual, forecast.forecast)})
            ledger.insert(0, 'model', name); ledger.insert(1, 'split', split)
            ledgers.append(ledger)
            predictions[(name, split)] = forecast
            if split == 'test':
                models[name] = {'model': model, 'columns': columns, 'configuration': selected[name],
                                'forecast_origin': forecast.iloc[-1].target_month, 'source_sha256': source_hash,
                                'limitations': LIMITATIONS}
    test_forecasts = data.loc[splits['test'], ['target_month', 'release_date', 'target_actual']].rename(
        columns={'target_actual': 'actual'}).copy()
    for name in variants:
        p = predictions[(name, 'test')].set_index('target_month')
        test_forecasts[name] = test_forecasts.target_month.map(p.forecast)
        test_forecasts[f'{name}_error'] = test_forecasts[name] - test_forecasts.actual
    for split in ['validation', 'test']:
        baseline = pd.DataFrame([{'target_month': data.loc[i, 'target_month'],
                                  'actual': data.loc[i, 'target_actual'], 'forecast': latest_three_mean(data, i)}
                                 for i in data.index[splits[split]]])
        metrics.append({'model': 'three_release_mean', 'split': split, **base.score(baseline.actual, baseline.forecast)})
        if split == 'test':
            test_forecasts['three_release_mean'] = baseline.forecast.to_numpy()
    ledger = pd.concat(ledgers, ignore_index=True)
    if not (ledger.latest_training_publication < ledger.target_month.map(data.set_index('target_month').release_date)).all():
        raise AssertionError('Training used an unpublished outcome')
    if base.hash_file(database) != source_hash:
        raise RuntimeError('Source DB changed')
    summary = {'source_database': str(database), 'source_sha256': source_hash, 'source_sha256_after': base.hash_file(database),
               'source_rows': len(raw), 'source_columns': len(raw.columns), 'core_features': CORE,
               'additional_adp_feature': 'adp_current_change', 'selected_settings': selected,
               'alpha_grid': base.ALPHAS, 'windows': WINDOWS, 'selection_metric': 'validation MAE',
               'splits': {k: int(m.sum()) for k,m in splits.items()},
               'test_policy': 'monthly refit; settings frozen after validation; published labels only',
               'cutoff': '20:00 ET day before each NFP release; date-only sources conservatively exclude NFP-day publications',
               'source_check_counts': checks.groupby(['feature', 'status']).size().reset_index(name='cells').to_dict('records'),
               'base_audit_masked_cells': len(masks), 'supporting_audit_hashes': audit_hashes,
               'versions': {'numpy': np.__version__, 'pandas': pd.__version__, 'sklearn': base.sklearn.__version__},
               'limitations': LIMITATIONS}
    output.mkdir(parents=True)
    data[['target_month', 'release_date', 'target_actual'] + CORE + ['adp_current_change']].to_csv(output / 'input_matrix.csv', index=False)
    coverage = pd.DataFrame([{'feature': k, **{part: int(data.loc[m, k].notna().sum()) for part,m in splits.items()}}
                             for k in CORE + ['adp_current_change']])
    coverage.to_csv(output / 'feature_coverage.csv', index=False)
    checks.to_csv(output / 'source_checks.csv', index=False)
    pd.DataFrame(masks).to_csv(output / 'base_audit_masked_cells.csv', index=False)
    pd.DataFrame(searches).to_csv(output / 'validation_search.csv', index=False)
    ledger.to_csv(output / 'training_ledger.csv', index=False)
    test_forecasts.to_csv(output / 'test_forecasts.csv', index=False)
    metrics = pd.DataFrame(metrics); metrics.to_csv(output / 'metrics.csv', index=False)
    for (name, split), frame in predictions.items():
        frame.to_csv(output / f'{name}_{split}_predictions.csv', index=False)
    for name, bundle in models.items():
        joblib.dump(bundle, output / f'{name}_last_origin.joblib')
    (output / 'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False), encoding='utf-8')
    write_report(output, summary, metrics, test_forecasts)
    print(metrics.round(3).to_string(index=False), flush=True)
    print('Output:', output, flush=True)


if __name__ == '__main__':
    main()
