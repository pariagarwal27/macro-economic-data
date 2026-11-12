"""Reproducible, fixed-holdout Ridge experiment on the complete NFP SQLite table.

Run from any directory: python scripts/train_nfp_ridge.py
The source database is opened read-only. Broad results are retrospective because
some supplied predictors have unverified historical availability/revised vintages.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import platform
import sqlite3
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.impute import MissingIndicator, SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
ALPHAS = [0.01, 0.1, 1., 10., 100., 1000., 10000., 100000., 1000000.]
METADATA = {
    'target_month', 'release_date', 'jolts_reference_month', 'jolts_release_timestamp',
    'ism_mfg_reference_month', 'ism_mfg_release_timestamp', 'ism_services_reference_month',
    'ism_services_release_timestamp', 'indeed_reference_week_start', 'indeed_reference_week_end',
    'indeed_latest_observation_date_revised', 'indeed_training_status', 'rpls_reference_month',
    'rpls_release_timestamp', 'ces_hours_reference_month', 'ces_hours_release_date',
    'ces_temp_help_reference_month', 'ces_temp_help_release_date',
}
LIMITATIONS = [
    'Broad model includes revised Indeed history, unverified consensus/ADP availability and sparse RPLS. '
    'Its scores are retrospective experimental results, not certified real-time forecast accuracy.',
    'Restricted comparison excludes ADP, consensus/surprise, Indeed and RPLS. Remaining source vintages '
    'and naive publication clocks are not fully independently certified by this script.',
    '2024–2026 was already inspected in earlier project work; it is a historical holdout, not a new untouched test.',
    'Target labels and all source measurements are accepted as supplied; this run does not reverify them against BLS archives.',
    'Models are frozen after refitting through 2023. Monthly test inputs can include earlier test-month releases '
    'that were public at the forecast cutoff, but no test targets are admitted to model fitting.',
    'All numeric measurement columns enter the broad pipeline. Dates and status text are metadata; '
    'target_actual is the outcome. Columns with no training variation cannot learn a useful coefficient.',
]


def classify_columns(data: pd.DataFrame):
    predictors, records = [], []
    for column in data:
        if column == 'target_actual':
            role, reason = 'label', 'Outcome being predicted; never a same-row input.'
        elif column in METADATA:
            role, reason = 'metadata', 'Calendar, source timing or audit status; used for identification/availability.'
        else:
            numeric = pd.to_numeric(data[column], errors='coerce')
            if numeric.notna().sum() != data[column].notna().sum():
                raise ValueError(f'Unexpected nonnumeric measurement column: {column}')
            predictors.append(column)
            role, reason = 'predictor', 'Numeric measurement candidate, including all-missing columns.'
        risk = ('retrospective revised history' if column.startswith('indeed_') else
                'sparse recent history' if column.startswith('rpls_') else
                'availability/vintage not fully verified' if 'consensus' in column or 'surprise' in column
                or column.startswith('adp_') or column == 'previous_adp_bls_gap' else '')
        records.append({'column': column, 'role': role, 'reason': reason,
                        'populated_original': int(data[column].notna().sum()), 'limitation': risk})
    return predictors, pd.DataFrame(records)


def split_masks(data: pd.DataFrame):
    months = data['target_month']
    return {'training': months <= '2020-12',
            'validation': (months >= '2021-01') & (months <= '2023-12'),
            'test': months >= '2024-01'}


def mask_known_unavailable(data: pd.DataFrame):
    result = data.copy()
    events = []
    releases = data.set_index('target_month')['release_date'].to_dict()

    def mask(index, column, reason):
        if column in result and pd.notna(result.at[index, column]):
            events.append({'target_month': result.at[index, 'target_month'], 'feature': column,
                           'original_value': result.at[index, column], 'reason': reason})
            result.at[index, column] = np.nan

    lag_columns = {1: 'previous_nfp', 2: 'nfp_2_months_ago', 3: 'nfp_3_months_ago'}
    families = {'jolts_': 'jolts_release_timestamp', 'ism_mfg_': 'ism_mfg_release_timestamp',
                'ism_services_': 'ism_services_release_timestamp', 'rpls_': 'rpls_release_timestamp',
                'ces_aggregate_weekly_hours_': 'ces_hours_release_date',
                'ces_temp_help_employment_': 'ces_temp_help_release_date'}
    for index, row in result.iterrows():
        available_lags = []
        for lag, column in lag_columns.items():
            prior = str(pd.Period(row.target_month, freq='M') - lag)
            prior_date = releases.get(prior)
            available = prior_date is not None and prior_date < row.release_date
            available_lags.append(available)
            if not available:
                mask(index, column, 'Prior target had not been published by the pre-release cutoff or is outside stored history.')
                if lag == 1:
                    for dependent in ['previous_surprise', 'previous_consensus', 'previous_adp_bls_gap']:
                        mask(index, dependent, 'Previous target release unavailable at cutoff.')
        if not all(available_lags):
            mask(index, 'average_previous_3_months', 'One or more contributing payroll releases unavailable.')
        cutoff = pd.Timestamp(row.release_date) - pd.Timedelta(days=1) + pd.Timedelta(hours=20)
        for prefix, clock in families.items():
            if clock not in result:
                continue
            raw = row[clock]
            stamp = pd.to_datetime(raw, errors='coerce')
            # Normalize aware clocks to ET. Naive clocks cannot establish full
            # timestamp certification (see report).
            if pd.notna(stamp) and stamp.tzinfo is not None:
                stamp = stamp.tz_convert('America/New_York').tz_localize(None)
            if pd.isna(stamp) or stamp > cutoff:
                for column in result.columns:
                    if column.startswith(prefix) and column not in METADATA:
                        mask(index, column, 'Family publication date/time missing or after selected cutoff.')
    return result, events


def apply_existing_audits(data: pd.DataFrame, connection):
    """Require value matches and pre-cutoff contributing release dates where audits exist."""
    result = data.copy()
    events = []
    month_index = dict(zip(result.target_month, result.index))
    for table in ['initial_claims_feature_audit', 'continuing_claims_feature_audit',
                  'jolts_extended_feature_audit']:
        audit = pd.read_sql_query(f'SELECT * FROM {table}', connection)
        for record in audit.to_dict('records'):
            feature, month = record['feature'], record['target_month']
            if feature not in result or feature in METADATA or month not in month_index:
                continue
            index = month_index[month]
            value = result.at[index, feature]
            if pd.isna(value):
                continue
            expected = pd.to_numeric(record['value'], errors='coerce')
            contributors = json.loads(record['contributors_json'])
            matched = pd.notna(expected) and np.isclose(float(value), float(expected), rtol=1e-7, atol=0.011)
            eligible = bool(contributors) and all(
                (item.get('release_date') or item.get('available_date')) and
                str(item.get('release_date') or item.get('available_date'))[:10] < result.at[index, 'release_date']
                for item in contributors)
            verified = str(record['status']).lower().startswith('verified')
            if not (matched and eligible and verified):
                events.append({'target_month': month, 'feature': feature, 'original_value': value,
                               'reason': f'{table}: unmatched, unverified, or unavailable contributors.'})
                result.at[index, feature] = np.nan
    return result, events


def make_pipeline(alpha: float):
    values = Pipeline([('impute', SimpleImputer(strategy='median', keep_empty_features=True)),
                       ('scale', StandardScaler())])
    features = FeatureUnion([('values', values), ('missing', MissingIndicator(features='all'))])
    return Pipeline([('features', features), ('ridge', Ridge(alpha=alpha, solver='svd'))])


def score(actual, forecast):
    y, p = np.asarray(actual, dtype=float), np.asarray(forecast, dtype=float)
    valid = np.isfinite(y) & np.isfinite(p)
    y, p = y[valid], p[valid]
    if not len(y):
        return {'months': 0}
    error = p - y
    return {'months': len(y), 'mae': float(np.abs(error).mean()),
            'rmse': float(np.sqrt(np.mean(error ** 2))), 'bias': float(error.mean()),
            'median_absolute_error': float(np.median(np.abs(error))),
            'max_absolute_error': float(np.abs(error).max()),
            'direction_accuracy_pct': float(100 * np.mean(np.sign(y) == np.sign(p)))}


def fit_experiment(data: pd.DataFrame, columns: list[str], alphas=ALPHAS):
    masks = split_masks(data)
    x = data[columns].apply(pd.to_numeric, errors='raise').astype(float)
    y = data.target_actual.astype(float)
    train, validation = masks['training'], masks['validation']
    candidates = []
    for alpha in alphas:
        pipeline = make_pipeline(alpha)
        pipeline.fit(x.loc[train], y.loc[train])
        metrics = score(y.loc[validation], pipeline.predict(x.loc[validation]))
        candidates.append({'alpha': float(alpha), **metrics})
    selected = min(candidates, key=lambda r: (r['mae'], -r['alpha']))['alpha']
    development_model = make_pipeline(selected).fit(x.loc[train], y.loc[train])
    final_mask = train | validation
    final_model = make_pipeline(selected).fit(x.loc[final_mask], y.loc[final_mask])
    forecasts = pd.Series(index=data.index, dtype=float)
    forecasts.loc[train | validation] = development_model.predict(x.loc[train | validation])
    forecasts.loc[masks['test']] = final_model.predict(x.loc[masks['test']])
    predictions = data[['target_month', 'target_actual']].copy()
    if 'release_date' in data:
        predictions.insert(1, 'release_date', data.release_date)
    predictions['split'] = np.select(list(masks.values()), list(masks.keys()), default='unknown')
    predictions['ridge_forecast'] = forecasts
    predictions['forecast_minus_actual'] = forecasts - y
    predictions['absolute_error'] = (forecasts - y).abs()
    for name, column in [('three_release_mean', 'average_previous_3_months'), ('previous_release', 'previous_nfp')]:
        if column not in data:
            continue
        baseline = pd.to_numeric(data[column], errors='raise').copy()
        # Explicit fallback for early/combined releases; never impute with test outcomes.
        baseline.loc[train | validation] = baseline.loc[train | validation].fillna(y.loc[train].median())
        baseline.loc[masks['test']] = baseline.loc[masks['test']].fillna(y.loc[final_mask].median())
        predictions[name] = baseline
    metrics = {}
    for split, mask in masks.items():
        metrics[split] = {name: score(y.loc[mask], predictions.loc[mask, name])
                          for name in ['ridge_forecast', 'three_release_mean', 'previous_release'] if name in predictions}
    return {'alpha': selected, 'alpha_scores': candidates, 'predictions': predictions,
            'metrics': metrics, 'model': final_model, 'development_model': development_model,
            'training_variable_columns': [k for k in columns if x.loc[train, k].nunique() > 1],
            'refit_variable_columns': [k for k in columns if x.loc[final_mask, k].nunique() > 1],
            'refit_all_missing_columns': [k for k in columns if x.loc[final_mask, k].isna().all()]}


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_report(output, summary, results, manifest):
    comparison = []
    for name, result in results.items():
        for split, models in result['metrics'].items():
            for model, metrics in models.items():
                comparison.append({'experiment': name, 'split': split, 'model': model, **metrics})
    comparison = pd.DataFrame(comparison)
    comparison.to_csv(output / 'metrics.csv', index=False)
    test = results['broad']['predictions'].query("split == 'test'").copy()
    restricted = results['restricted']['predictions'].set_index('target_month').ridge_forecast
    test['restricted_ridge_forecast'] = test.target_month.map(restricted)
    test.to_csv(output / 'test_forecasts.csv', index=False)
    broad_mae = results['broad']['metrics']['test']['ridge_forecast']['mae']
    baseline_mae = results['broad']['metrics']['test']['three_release_mean']['mae']
    difference_pct = 100 * (broad_mae / baseline_mae - 1)
    interpretation = (
        f'The broad Ridge test MAE is {broad_mae:.2f} thousand jobs, versus {baseline_mae:.2f} for the '
        f'three-release average with a historical-median fallback when unavailable. Ridge has '
        f'{difference_pct:.1f}% higher MAE in this run. Its test forecasts range from '
        f'{test.ridge_forecast.min():.2f} to {test.ridge_forecast.max():.2f} thousand jobs. '
        f'The selected broad alpha ({results["broad"]["alpha"]:g}) is the upper boundary of the predefined grid; '
        'it applies strong shrinkage and produces an almost constant forecast. This is the best tested '
        'grid setting, not proof of a global optimum. The all-column specification is not promoted for forecasting.'
    )
    warnings = ''.join('<li>' + html.escape(s) + '</li>' for s in LIMITATIONS)
    split_table = pd.DataFrame(summary['splits']).T.to_html(border=0)
    document = f'''<!doctype html><html lang="en"><meta charset="utf-8">
<title>NFP Ridge experiment — November 5, 2026</title>
<style>body{{font:16px system-ui,sans-serif;margin:36px auto;max-width:1300px;padding:0 24px;color:#1b2937}}
h1,h2{{color:#123c57}}table{{border-collapse:collapse;width:100%;font-size:13px;margin:18px 0}}
th,td{{padding:9px;border-bottom:1px solid #dce3e9;text-align:right}}th:first-child,td:first-child{{text-align:left}}
thead{{background:#eaf1f6}}.notice{{background:#fff3d6;padding:16px;border-left:5px solid #bf8500}}
.scroll{{overflow-x:auto}}li{{margin:9px 0}}a{{color:#075a89}}</style>
<h1>NFP Ridge regression: historical experiment</h1>
<p>Source: nfp_new.sqlite3 / nfp_training. {summary['rows']} monthly outcomes, {summary['source_columns']} source columns.
All figures are in thousands of jobs. Error = forecast − actual.</p>
<div class="notice"><strong>Retrospective experiment.</strong> The broad model uses all {summary['numeric_candidates']} numeric predictor candidates,
including fields without certified historical vintages. These results do not establish deployable real-time accuracy.</div>
<h2>Chronological split</h2>{split_table}
<p>Each alpha is fitted on training only and scored on validation MAE. Selected broad alpha: {results['broad']['alpha']:g};
restricted alpha: {results['restricted']['alpha']:g}. After selection, refit through December 2023 and freeze throughout test.
Training scores are in-sample; validation scores are used for tuning; test scores use the frozen refit model.</p>
<h2>Results</h2><div class="scroll">{comparison.round(3).to_html(index=False,border=0)}</div>
<p><strong>Interpretation:</strong> {html.escape(interpretation)}</p>
<h2>Every test forecast</h2><div class="scroll">{test.round(2).to_html(index=False,border=0)}</div>
<h2>Inputs and limitations</h2><ul>{warnings}</ul>
<p>Broad model: {len(results['broad']['training_variable_columns'])} measurement columns vary during initial training;
{len(results['broad']['refit_variable_columns'])} vary during the final refit. All-missing refit columns:
{html.escape(', '.join(results['broad']['refit_all_missing_columns']))}. Their coefficients cannot learn a signal.</p>
<p>Known unavailable or audit-mismatched cells masked: {summary['masked_cells']}. Dates and status fields remain in source exports
and the 96-column manifest, but do not enter the regression. Median imputation and standardization use fitted historical rows only;
missingness indicators are binary and unscaled.</p>
<p><a href="test_forecasts.csv">Test forecasts CSV</a> · <a href="metrics.csv">Metrics CSV</a> ·
<a href="column_manifest.csv">Column manifest</a> · <a href="summary.json">Run settings and source hash</a></p></html>'''
    (output / 'report.html').write_text(document, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'data/databases/nfp_new.sqlite3')
    parser.add_argument('--output', type=Path, default=ROOT / 'results/ridge_2026-11-05_final')
    args = parser.parse_args()
    database, output = args.database.resolve(), args.output.resolve()
    if output.exists():
        raise FileExistsError(f'Choose a fresh output directory; refusing to overwrite {output}')
    source_hash = hash_file(database)
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        data = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', connection)
        if data.target_month.duplicated().any() or data.target_actual.isna().any():
            raise ValueError('Duplicate months or missing targets')
        expected = pd.period_range(data.target_month.min(), data.target_month.max(), freq='M').astype(str)
        if data.target_month.tolist() != expected.tolist():
            raise ValueError('Monthly timeline is not continuous')
        calendar = pd.read_sql_query('SELECT target_month,release_date FROM nfp_release_calendar', connection)
        checked = data[['target_month', 'release_date']].merge(calendar, on='target_month', validate='one_to_one')
        if len(checked) != len(data) or not checked.release_date_x.eq(checked.release_date_y).all():
            raise ValueError('Target release dates disagree with release calendar')
        columns, manifest = classify_columns(data)
        prepared, masks = mask_known_unavailable(data)
        prepared, audit_masks = apply_existing_audits(prepared, connection)
        masks.extend(audit_masks)
    split = split_masks(prepared)
    if [int(split[k].sum()) for k in split] != [252, 36, 33]:
        raise ValueError('Source differs from the specified 252/36/33-row experiment')
    restricted = [k for k in columns if not k.startswith(('adp_', 'indeed_', 'rpls_'))
                  and 'consensus' not in k and 'surprise' not in k and k != 'previous_adp_bls_gap']
    results = {'broad': fit_experiment(prepared, columns),
               'restricted': fit_experiment(prepared, restricted)}
    if hash_file(database) != source_hash:
        raise RuntimeError('Source database hash changed during experiment')
    summary = {'database': str(database), 'source_sha256': source_hash, 'source_sha256_after': hash_file(database),
               'rows': len(data), 'source_columns': len(data.columns), 'numeric_candidates': len(columns),
               'metadata_columns': len(METADATA.intersection(data.columns)), 'masked_cells': len(masks),
               'units': 'thousands of jobs', 'error_definition': 'forecast minus actual',
               'selection': 'minimum validation MAE; larger alpha on exact ties', 'alpha_grid': ALPHAS,
               'test_policy': 'single frozen refit through 2023-12; no test-label refitting',
               'cutoff': '20:00 ET on day before stored NFP release date; see clock-certification limitation',
               'versions': {'python': platform.python_version(), 'pandas': pd.__version__,
                            'numpy': np.__version__, 'scikit_learn': sklearn.__version__},
               'splits': {k: {'rows': int(m.sum()), 'first_month': data.loc[m, 'target_month'].min(),
                              'last_month': data.loc[m, 'target_month'].max()} for k, m in split.items()},
               'limitations': LIMITATIONS,
               'experiments': {k: {a: v for a, v in r.items() if a not in
                                  {'model', 'development_model', 'predictions'}} for k, r in results.items()}}
    output.mkdir(parents=True)
    for name, result in results.items():
        result['predictions'].to_csv(output / f'{name}_all_predictions.csv', index=False)
        pd.DataFrame(result['alpha_scores']).to_csv(output / f'{name}_validation_alpha_scores.csv', index=False)
        features = columns if name == 'broad' else restricted
        coefficients = result['model'].named_steps['ridge'].coef_
        pd.DataFrame({'feature': features + [f'{k}__missing' for k in features],
                      'coefficient': coefficients}).assign(absolute_coefficient=np.abs(coefficients)).sort_values(
                          'absolute_coefficient', ascending=False).to_csv(output / f'{name}_coefficients.csv', index=False)
        joblib.dump({'pipeline': result['model'], 'columns': features,
                     'trained_through': '2023-12', 'source_sha256': source_hash,
                     'limitations': LIMITATIONS}, output / f'{name}_ridge.joblib')
    for name, mask in split.items():
        data.loc[mask].to_csv(output / f'{name}_source_rows.csv', index=False)
        prepared.loc[mask].to_csv(output / f'{name}_prepared_rows.csv', index=False)
        manifest[f'populated_{name}_after_masks'] = [int(prepared.loc[mask, k].notna().sum()) for k in manifest.column]
    manifest['included_broad'] = manifest.column.isin(columns)
    manifest['included_restricted'] = manifest.column.isin(restricted)
    manifest.to_csv(output / 'column_manifest.csv', index=False)
    pd.DataFrame(masks, columns=['target_month', 'feature', 'original_value', 'reason']).to_csv(
        output / 'masked_cells.csv', index=False)
    (output / 'summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False), encoding='utf-8')
    write_report(output, summary, results, manifest)
    print(json.dumps({'output': str(output), 'numeric_predictors': len(columns), 'masked_cells': len(masks),
                      'results': {k: {'alpha': r['alpha'], 'metrics': r['metrics'],
                                      'refit_all_missing_columns': r['refit_all_missing_columns']} for k, r in results.items()}}, indent=2))


if __name__ == '__main__':
    main()
