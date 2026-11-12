"""Compare the existing NFP candidate with original-vintage ADP industry inputs."""
import json
import sqlite3
from pathlib import Path

import pandas as pd
import train_nfp_ridge as base
import train_compact_nfp_ridge as compact
import train_surprise_midas_ensemble as legacy
import train_lightgbm_failure_fixes as experiment

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'data/databases/nfp_new.sqlite3'
OUT = ROOT / 'results/adp_industry_comparison'

def main():
    with sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True) as db:
        raw = pd.read_sql_query('SELECT * FROM nfp_training ORDER BY target_month', db)
        features, _ = base.classify_columns(raw)
        data, _, _, _ = compact.build_inputs(db, raw)
        sectors = pd.read_sql_query('SELECT * FROM adp_industry_first_release', db)
    data = legacy.add_surprise_index(legacy.add_regime(data))
    candidates = [x for x in features + legacy.REGIME + ['surprise_lag_1', 'surprise_index_3m'] if not x.startswith('indeed_')]
    sectors['value'] = sectors['value'] / 1000.0
    wide = sectors.pivot(index='reference_month', columns='sector', values='value').add_prefix('adp_sector_')
    release = sectors.groupby('reference_month').release_date.first()
    data = data.join(wide, on='target_month')
    sector_columns = list(wide.columns)
    data['adp_sector_release'] = data.target_month.map(release)
    # Date-only publication evidence is sufficient only if the report was
    # published at least one calendar day before the BLS release.
    timely = data.adp_sector_release.notna() & (data.adp_sector_release < data.release_date.astype(str).str[:10])
    data.loc[~timely, sector_columns] = float('nan')
    config = {'window':'rolling120','max_depth':2,'num_leaves':4,'min_child_samples':20,'n_estimators':100,'learning_rate':0.03}
    rows = []
    for origin in data.index[(data.target_month >= '2024-01') & timely]:
        baseline, _, _, _ = experiment.replay(data, candidates, origin, config, True)
        enhanced, _, chosen, _ = experiment.replay(data, candidates + sector_columns, origin, config, True)
        rows.append(dict(target_month=data.at[origin,'target_month'], actual=data.at[origin,'target_actual'], consensus=data.at[origin,'current_consensus'], baseline=baseline, industries=enhanced, sectors_selected=sum(c in chosen for c in sector_columns)))
    results = pd.DataFrame(rows)
    if results.empty: raise ValueError('No eligible evaluation months')
    OUT.mkdir(parents=True, exist_ok=True)
    results.to_csv(OUT/'forecasts.csv', index=False)
    summary = {name: experiment.metrics(results.actual, results[name]) for name in ['baseline','industries','consensus']}
    summary.update(first_month=str(results.target_month.min()), last_month=str(results.target_month.max()), months=len(results), months_with_selected_sectors=int((results.sectors_selected > 0).sum()), caveat='Diagnostic only; historical availability of other inputs is not fully certified. No new untouched holdout.')
    (OUT/'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))

if __name__ == '__main__': main()
