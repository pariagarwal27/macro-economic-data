"""Immutable CES vintage overlays and one audited historical/live row interface."""
import csv
import hashlib
import io
import json
import sqlite3
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

import create_revised_lightgbm_current_forecast as legacy
from nfp_release_pipeline import Evidence, build_row, vintage_features

ROOT=Path(__file__).resolve().parents[1]
SUPPLEMENT=ROOT/'data/forecast_sources'
VINTAGE_FEATURES=[f'payroll_known_lag{i}' for i in range(1,4)]+[f'payroll_revision_lag{i}' for i in range(1,4)]+['payroll_known_mean3']
TEMP_FEATURES=['ces_temp_help_employment_latest','ces_temp_help_employment_previous','ces_temp_help_employment_change','ces_temp_help_employment_3m_avg']


def cutoff_for(release_date):
    return (pd.Timestamp(release_date).tz_localize('America/New_York')-pd.Timedelta(days=1)+pd.Timedelta(hours=20)).isoformat()


def release_time(day):
    return (pd.Timestamp(day).tz_localize('America/New_York')+pd.Timedelta(hours=8,minutes=30)).isoformat()


def read_ces_vintages(path, calendar):
    """Keep the five latest reference months in each authentic release vintage."""
    path=Path(path)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    records=[]
    month_lookup={m:i+1 for i,m in enumerate(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}
    with zipfile.ZipFile(path) as archive:
        for series,member in [('payroll','tri_000000_SA.csv'),('temporary_help','tri_909320_SA.csv')]:
            rows=csv.reader(io.TextIOWrapper(archive.open(member),encoding='utf-8-sig'))
            headers=next(rows)
            refs=[]
            for label in headers[2:]:
                month,year=label.split('_'); number=int(year)
                refs.append(f'{1900+number if number>=70 else 2000+number:04d}-{month_lookup[month]:02d}')
            for row in rows:
                vintage=f'{int(row[0]):04d}-{int(row[1]):02d}'
                if vintage not in calendar:
                    continue
                lower_ref=str(pd.Period(vintage,freq='M')-4)
                for ref,value in zip(refs,row[2:]):
                    if not lower_ref<=ref<=vintage:
                        continue
                    try:
                        number=float(value)
                    except (ValueError,TypeError):
                        continue
                    if np.isfinite(number):
                        records.append(dict(series=series,reference_month=ref,vintage_month=vintage,value=number,published_at=release_time(calendar[vintage]),source_url='https://www.bls.gov/web/empsit/cesvinall.zip#'+member,source_sha256=digest,source_path=str(path)))
    return records


def load_sources(connection, extra_zip=None):
    calendar=dict(connection.execute('SELECT target_month,release_date FROM nfp_release_calendar'))
    paths=[ROOT/'data/ces/raw/cesvinall.zip']
    if extra_zip:
        paths.append(Path(extra_zip))
    records=[]
    for path in paths:
        records.extend(read_ces_vintages(path,calendar))
    return records


def load_history(extra_zip=None):
    digest=legacy.base.hash_file(legacy.DATABASE)
    with sqlite3.connect(legacy.DATABASE.as_uri()+'?mode=ro',uri=True) as connection:
        raw=pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month',connection)
        predictors,_=legacy.base.classify_columns(raw)
        data,checks,masks,_=legacy.compact.build_inputs(connection,raw)
        records=load_sources(connection,extra_zip)
    data=legacy.legacy.add_surprise_index(legacy.legacy.add_regime(data))
    candidates=[x for x in predictors+legacy.legacy.REGIME+['surprise_lag_1','surprise_index_3m'] if not x.startswith(('indeed_','rpls_','ces_temp_help_'))]
    first_releases=data.set_index('target_month').target_actual.to_dict()
    result,audits=[],[]
    for _,row in data.iterrows():
        cutoff=cutoff_for(row.release_date)
        # Existing audits certify several families, but not every input's exact
        # publication clock. Preserve that distinction instead of inventing one.
        evidence=[Evidence(x,float(row[x]),row.target_month,cutoff,str(legacy.DATABASE),digest,'conditional','legacy_availability_bound')
                  for x in candidates if pd.notna(row[x])]
        evidence+=vintage_features(row.target_month,cutoff,records,first_releases)
        values,audit=build_row(row.target_month,cutoff,evidence,allow_conditional=True)
        values.update(target_month=row.target_month,release_date=row.release_date,target_actual=row.target_actual)
        result.append(values)
        audits.extend(dict(detail,target_month=row.target_month,feature=feature) for feature,detail in audit.items())
    output=pd.DataFrame(result)
    for feature in candidates+VINTAGE_FEATURES+TEMP_FEATURES:
        if feature not in output:
            output[feature]=np.nan
    assert legacy.base.hash_file(legacy.DATABASE)==digest
    return output,records,pd.DataFrame(audits),dict(source_database_sha256=digest,legacy_masks=len(masks),historical_status='conditional_research',conditional_reason='Existing audit-approved numeric inputs retained under the prior availability assumption; exact publication clocks and consensus captures are not newly certified.')


def live_row(manifest_path, records, first_releases, required_features, *, allow_conditional=False):
    payload=json.loads(Path(manifest_path).read_text())
    evidence=[Evidence(**item) for item in payload['observations']]
    evidence+=vintage_features(payload['target_month'],payload['cutoff'],records,first_releases)
    values,audit=build_row(payload['target_month'],payload['cutoff'],evidence,allow_conditional=allow_conditional)
    missing=[feature for feature in required_features if feature not in values or pd.isna(values[feature])]
    return values,dict(complete=not missing,missing_features=missing,feature_audit=audit)


def export_source_coverage(data, records, out):
    out=Path(out)
    out.mkdir(parents=True,exist_ok=True)
    pd.DataFrame(records).to_csv(out/'supplemental_ces_vintages.csv',index=False)
    columns=['target_month']+VINTAGE_FEATURES+TEMP_FEATURES
    data[columns].to_csv(out/'release_aware_overlay.csv',index=False)
    needed=data[data.target_month>='2024-01']
    gaps=needed.loc[needed.payroll_known_lag1.isna()|needed.ces_temp_help_employment_latest.isna(),'target_month'].tolist()
    summary=dict(last_vintage_month=max(r['vintage_month'] for r in records),supplemental_observations=len(records),recent_missing_months=gaps,source_database_modified=False,download_attempts=[dict(url='https://www.bls.gov/news.release/archives/empsit_10022026.htm',result='HTTP 403 access denied'),dict(url='https://www.dol.gov/newsroom/economicdata/empsit_10022026.pdf',result='HTTP 403 access denied')])
    (out/'coverage.json').write_text(json.dumps(summary,indent=2))
    return summary
