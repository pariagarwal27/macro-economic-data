"""Evidence-required live forecast entry point; no silent candidate promotion."""
import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

import nfp_corrected_data as source
import nfp_release_pipeline as policy
from train_lightgbm_failure_fixes import prune_correlated_features


def validate_manifest(payload):
    required={'target_month','cutoff','target_release_at','observations'}
    if not required.issubset(payload) or not isinstance(payload['observations'],list):
        raise ValueError('Manifest requires target_month, timezone-aware cutoff, target_release_at, and timestamped observations')
    pd.Period(payload['target_month'],freq='M')
    target_month=payload['target_month']
    with sqlite3.connect(source.legacy.DATABASE.as_uri()+'?mode=ro',uri=True) as connection:
        row=connection.execute('SELECT release_date FROM nfp_release_calendar WHERE target_month=?',(target_month,)).fetchone()
    if not row:
        raise ValueError('Target month is absent from the official release calendar')
    official_release=policy.timestamp(source.release_time(row[0]))
    supplied_release=policy.timestamp(payload['target_release_at'])
    expected_cutoff=policy.timestamp(source.cutoff_for(row[0]))
    if supplied_release!=official_release:
        raise ValueError('Target release timestamp does not match the official release calendar')
    if policy.timestamp(payload['cutoff'])!=expected_cutoff:
        raise ValueError('Cutoff must match the project rule: 8:00 p.m. Eastern on the prior day')
    if any(key in payload for key in ['actual','target_actual','actual_nfp']):
        raise ValueError('The target outcome cannot be supplied in a forecast manifest')
    for item in payload['observations']:
        evidence=policy.Evidence(**item)
        if evidence.status!='verified' or evidence.time_basis!='publication':
            raise ValueError('Live manifests require verified publication-time evidence')
        if not evidence.source_path:
            raise ValueError('Live evidence must identify a local source file for fingerprint verification')


def create_forecast(manifest_path):
    payload=json.loads(Path(manifest_path).read_text())
    validate_manifest(payload)
    registry_path=source.ROOT/'results/active_nfp_model.json'
    if not registry_path.exists():
        raise ValueError('Run train_corrected_nfp.py to create an evaluated model registry first')
    registry=json.loads(registry_path.read_text())
    if not registry.get('forecast_allowed',False):
        raise ValueError('Forecast blocked: no model has passed historical performance and source-evidence promotion gates')
    if registry['active_model']=='revised_no_indeed_pruned':
        # Incumbent is preserved exactly. Its historical provenance remains
        # conditional and is disclosed in every new forecast.
        legacy=source.legacy
        digest=legacy.base.hash_file(legacy.DATABASE)
        with sqlite3.connect(legacy.DATABASE.as_uri()+'?mode=ro',uri=True) as connection:
            raw=pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month',connection)
            predictors,_=legacy.base.classify_columns(raw)
            data,_,_,_=legacy.compact.build_inputs(connection,raw)
            records=source.load_sources(connection)
        data=legacy.legacy.add_surprise_index(legacy.legacy.add_regime(data))
        candidates=[x for x in predictors+legacy.legacy.REGIME+['surprise_lag_1','surprise_index_3m'] if not x.startswith('indeed_')]
        config=json.loads((legacy.RESULTS/'october_2026_revised_forecast.json').read_text())['selected_lightgbm']
    else:
        raise ValueError('No corrected candidate is currently approved for live use; unknown registry model rejected')
    first=data.set_index('target_month').target_actual.to_dict()
    values,audit=source.live_row(manifest_path,records,first,[],allow_conditional=False)
    cutoff=policy.timestamp(payload['cutoff'])
    eligible=(data.target_month<payload['target_month']) & data.release_date.map(lambda value:policy.timestamp(source.release_time(value))<=cutoff)
    beginning=str(pd.Period(payload['target_month'],freq='M')-120)
    training=data.loc[eligible & (data.target_month>=beginning)]
    if len(training)<24:
        raise ValueError('Insufficient previously published training outcomes')
    target=training.target_actual.astype(float)-training.current_consensus.astype(float)
    selected,_=prune_correlated_features(training,candidates,target)
    required=sorted(set(selected+['current_consensus']))
    missing=[feature for feature in required if feature not in values or not np.isfinite(values[feature])]
    if missing:
        raise ValueError('Forecast blocked: missing eligible evidence for '+', '.join(missing))
    model=legacy.legacy.make_lgb(config)
    model.fit(training[selected].astype(float),target)
    surprise=float(model.predict(pd.DataFrame([values])[selected].astype(float))[0])
    consensus=float(values['current_consensus'])
    assert legacy.base.hash_file(legacy.DATABASE)==digest
    generated=pd.Timestamp.now(tz='UTC')
    return dict(target_month=payload['target_month'],generated_at=generated.isoformat(),cutoff=payload['cutoff'],target_release_at=payload['target_release_at'],
                timing_status='retrospective_reconstruction' if generated>policy.timestamp(payload['target_release_at']) else 'generated_before_target_release',
                active_model=registry['active_model'],training_status='conditional_historical_provenance',training_rows=len(training),
                first_training_month=training.target_month.min(),last_training_month=training.target_month.max(),
                consensus_thousands=consensus,predicted_surprise_thousands=surprise,forecast_thousands=consensus+surprise,
                forecast_jobs=round((consensus+surprise)*1000),feature_audit=audit,source_database_sha256=digest)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,required=True,help='Timestamped source evidence; a value-only CSV is rejected')
    parser.add_argument('--output',type=Path,required=True,help='A new output path; existing forecasts are never overwritten')
    args=parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists; choose a new path to preserve forecast history')
    try:
        result=create_forecast(args.manifest)
    except (ValueError,TypeError,KeyError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as stream:
        json.dump(result,stream,indent=2)
    print(json.dumps({key:result[key] for key in ['target_month','active_model','timing_status','forecast_jobs']},indent=2))


if __name__=='__main__':
    main()
