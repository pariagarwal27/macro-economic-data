"""Score explicitly frozen forecast records against verified first prints.

Input assertions are supplied by the operator and must be independently audited;
this script does not verify evidence files or establish historical provenance.
"""
import argparse
import json
import math
import sqlite3
from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from point_in_time_archive import timestamp


def select_cutoff_forecast(rows, release_at):
    """Latest recorded non-null forecast by 8 p.m. ET on the prior day."""
    release = timestamp(release_at).to_pydatetime().astimezone(ZoneInfo('America/New_York'))
    cutoff = datetime.combine(release.date() - timedelta(days=1), time(20), tzinfo=ZoneInfo('America/New_York'))
    eligible = [row for row in rows if timestamp(row['created_at']) <= cutoff
                and row.get('forecast_value') is not None and row.get('consensus_value') is not None]
    return max(eligible, key=lambda row: timestamp(row['created_at'])) if eligible else None


def forecasts_from_database(connection, model_id):
    """Select previously saved snapshots; this does not certify their provenance."""
    cursor = connection.execute('SELECT target_month, release_at, created_at, forecast_value, consensus_value FROM nfp_forecast_runs WHERE model_id = ?', (model_id,))
    names = [item[0] for item in cursor.description]
    groups = {}
    for values in cursor:
        row = dict(zip(names, values))
        groups.setdefault((row['target_month'], row['release_at']), []).append(row)
    result = []
    seen = set()
    for (month, release_at), rows in sorted(groups.items()):
        if month in seen:
            raise ValueError('Multiple scheduled releases for target month: ' + month)
        seen.add(month)
        selected = select_cutoff_forecast(rows, release_at)
        if selected is None:
            continue
        release = timestamp(release_at).to_pydatetime().astimezone(ZoneInfo('America/New_York'))
        cutoff = datetime.combine(release.date() - timedelta(days=1), time(20), tzinfo=ZoneInfo('America/New_York'))
        result.append(dict(target_month=month, release_at=release_at, cutoff=timestamp(cutoff).isoformat(),
                           generated_at=selected['created_at'], consensus=selected['consensus_value'], forecast=selected['forecast_value']))
    return result


def score_pairs(forecasts, actuals):
    def unique(rows):
        result = {}
        for row in rows:
            key = row['target_month']
            if key in result:
                raise ValueError('Duplicate target month: ' + key)
            result[key] = row
        return result
    fs, outcomes = unique(forecasts), unique(actuals)
    pairs, excluded = [], []
    for month, f in fs.items():
        a = outcomes.get(month)
        if not a or a.get('verified') is not True:
            excluded.append({'target_month': month, 'reason': 'missing or unverified first print'})
            continue
        if timestamp(f['release_at']) != timestamp(a['release_at']):
            excluded.append({'target_month': month, 'reason': 'release mismatch'})
            continue
        if not timestamp(f['generated_at']) <= timestamp(f['cutoff']) < timestamp(f['release_at']):
            excluded.append({'target_month': month, 'reason': 'forecast after cutoff'})
            continue
        y, c, p = (float(a['first_print']), float(f['consensus']), float(f['forecast']))
        if not all(map(math.isfinite, (y, c, p))):
            raise ValueError('Nonfinite forecast or outcome')
        pairs.append({'target_month': month, 'actual': y, 'consensus': c, 'forecast': p,
                      'consensus_absolute_error': abs(c-y), 'model_absolute_error': abs(p-y)})
    n = len(pairs)
    return {'months': n, 'consensus_mae': sum(x['consensus_absolute_error'] for x in pairs)/n if n else None,
            'model_mae': sum(x['model_absolute_error'] for x in pairs)/n if n else None,
            'pairs': pairs, 'excluded': excluded,
            'limitation': 'Record authenticity, fixed cutoff and source provenance require independent verification; small samples cannot establish reliable outperformance.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--forecasts', type=Path)
    source.add_argument('--database', type=Path)
    parser.add_argument('--model-id', default='revised_no_indeed_pruned')
    parser.add_argument('--actuals', type=Path, required=True)
    args = parser.parse_args()
    if args.database:
        with sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True) as db:
            forecasts = forecasts_from_database(db, args.model_id)
    else:
        forecasts = json.loads(args.forecasts.read_text())
    print(json.dumps(score_pairs(forecasts, json.loads(args.actuals.read_text())), indent=2))

if __name__ == '__main__':
    main()
