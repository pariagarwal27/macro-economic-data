"""Walk-forward comparison using dated first-release ADP, CES and Census data."""
import json
import sqlite3
from pathlib import Path
import numpy as np
import pandas as pd
import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
import train_surprise_midas_ensemble as legacy
import train_lightgbm_failure_fixes as exp

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'data/databases/nfp_new.sqlite3'
OUT = ROOT / 'results/birth_death_sources_diagnostic'

def main():
    with sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True) as db:
        raw = pd.read_sql_query('select * from nfp_training order by target_month',db)
        predictors,_ = base.classify_columns(raw)
        data,_,_,_ = compact.build_inputs(db,raw)
        adp = pd.read_sql_query('select * from adp_industry_first_release',db)
        ces = pd.read_sql_query('select * from ces_industry_first_release',db)
        bfs = pd.read_sql_query('select * from bfs_wba_first_release order by release_date',db)
        birth = pd.read_sql_query('select * from bls_birth_death_preliminary',db)
    data = legacy.add_surprise_index(legacy.add_regime(data))
    base_features = [f for f in predictors+legacy.REGIME+['surprise_lag_1','surprise_index_3m'] if not f.startswith('indeed_')]
    adp['value'] /= 1000
    aw = adp.pivot(index='reference_month',columns='sector',values='value').add_prefix('adp_sector_')
    data = data.join(aw,on='target_month')
    ar = adp.groupby('reference_month').release_date.first()
    data.loc[~(data.target_month.map(ar).notna() & (data.target_month.map(ar)<data.release_date.astype(str).str[:10])),list(aw.columns)] = np.nan
    cw = ces.pivot(index='reference_month',columns='sector',values='change_thousands').add_prefix('ces_first_sector_')
    # The target month's official CES values are never eligible; use only the prior release.
    previous = (pd.PeriodIndex(data.target_month,freq='M')-1).astype(str)
    for col in cw.columns: data[col] = previous.map(cw[col])
    cr = ces.groupby('reference_month').release_date.first()
    data.loc[~(previous.map(cr).notna() & (previous.map(cr)<data.release_date.astype(str).str[:10])),list(cw.columns)] = np.nan
    b = bfs.sort_values('release_date')
    values=[]
    for release in data.release_date.astype(str).str[:10]:
        eligible=b[b.release_date < release]
        values.append(float(eligible.iloc[-1].value) if not eligible.empty else np.nan)
    data['bfs_wba_first_release']=values
    bv=birth.set_index('reference_month').value_thousands
    bd=birth.set_index('reference_month').release_date
    data['bls_birth_death_lag1']=previous.map(bv)
    data.loc[~(previous.map(bd).notna() & (previous.map(bd)<data.release_date.astype(str).str[:10])),'bls_birth_death_lag1']=np.nan
    added=list(aw.columns)+list(cw.columns)+['bfs_wba_first_release']
    config={'window':'rolling120','max_depth':2,'num_leaves':4,'min_child_samples':20,'n_estimators':100,'learning_rate':0.03}
    rows=[]
    for origin in data.index[data.target_month >= '2024-01']:
        standard,_,_,_=exp.replay(data,base_features,origin,config,True)
        enhanced,_,selected,_=exp.replay(data,base_features+added,origin,config,True)
        with_birth,_,birth_selected,_=exp.replay(data,base_features+added+['bls_birth_death_lag1'],origin,config,True)
        rows.append(dict(target_month=data.at[origin,'target_month'],release_date=str(data.at[origin,'release_date'])[:10],actual=data.at[origin,'target_actual'],consensus=data.at[origin,'current_consensus'],baseline=standard,enhanced=enhanced,with_birth_death=with_birth,birth_death_available=pd.notna(data.at[origin,'bls_birth_death_lag1']),birth_death_selected='bls_birth_death_lag1' in birth_selected,selected_added=sum(f in selected for f in added),bfs_available=pd.notna(data.at[origin,'bfs_wba_first_release']),ces_available=bool(data.loc[origin,list(cw.columns)].notna().any())))
    frame=pd.DataFrame(rows)
    for model in ['baseline','enhanced','with_birth_death']:
        errors=[]; lower=[]; upper=[]
        for _,row in frame.iterrows():
            available=[error for released,error in errors if released < row.release_date]
            if len(available)>=12:
                radius=float(np.quantile(np.abs(available),.8,method='higher'))
                lower.append(row[model]-radius); upper.append(row[model]+radius)
            else: lower.append(np.nan); upper.append(np.nan)
            errors.append((row.release_date,float(row.actual-row[model])))
        frame[model+'_lower80']=lower; frame[model+'_upper80']=upper
    OUT.mkdir(parents=True,exist_ok=True)
    frame.to_csv(OUT/'forecasts.csv',index=False)
    summary={name:exp.metrics(frame.actual,frame[name]) for name in ['baseline','enhanced','with_birth_death','consensus']}
    for model in ['baseline','enhanced','with_birth_death']:
        valid=frame[frame[model+'_lower80'].notna()]
        summary[model]['interval_months']=len(valid)
        summary[model]['interval_coverage']=float(((valid.actual>=valid[model+'_lower80']) & (valid.actual<=valid[model+'_upper80'])).mean()) if len(valid) else None
        summary[model]['interval_mean_width_thousands']=float((valid[model+'_upper80']-valid[model+'_lower80']).mean()) if len(valid) else None
    summary.update(first_month=str(frame.target_month.min()),last_month=str(frame.target_month.max()),bfs_months=int(frame.bfs_available.sum()),ces_months=int(frame.ces_available.sum()),birth_death_months=int(frame.birth_death_available.sum()),birth_death_selected_months=int(frame.birth_death_selected.sum()),added_selected_months=int((frame.selected_added>0).sum()),caveat='Research diagnostic; earlier test period has been examined and provenance of other inputs remains conditional. The 2026 birth-death current table has not been independently archived by release. Intervals use prior diagnostic errors only.')
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary,indent=2))

if __name__=='__main__': main()
