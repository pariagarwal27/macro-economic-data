"""Shared release-aware feature contracts and conservative promotion policy.

Units for forecasts/metrics are thousands of jobs. Evidence values retain each
source feature's units. Conditional research data are never called verified.
"""
from dataclasses import dataclass, asdict
import hashlib
import json
import re
from pathlib import Path
import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Evidence:
    feature: str
    value: float
    reference_month: str
    published_at: str
    source_url: str
    source_sha256: str
    source_path: str = ''
    status: str = 'verified'
    time_basis: str = 'publication'


def timestamp(value):
    parsed = pd.Timestamp(value)
    if pd.isna(parsed) or parsed.tzinfo is None:
        raise ValueError('timezone_missing')
    return parsed.tz_convert('UTC')


def build_row(target_month, cutoff, observations, *, allow_conditional=False):
    """Identical historical/live validation; late evidence never replaces valid evidence."""
    boundary = timestamp(cutoff)
    pd.Period(target_month, freq='M')
    values, audit, selected = {}, {}, {}
    for item in observations:
        if isinstance(item, dict):
            item = Evidence(**item)
        reason = None
        try:
            publication = timestamp(item.published_at)
        except (ValueError, TypeError):
            publication, reason = None, 'timezone_missing'
        if reason is None:
            if publication > boundary:
                reason = 'published_after_cutoff'
            elif pd.Period(item.reference_month, freq='M') > pd.Period(target_month, freq='M'):
                reason = 'future_reference_period'
            elif not item.source_url or not re.fullmatch(r'[0-9a-f]{64}', item.source_sha256):
                reason = 'source_evidence_missing'
            elif not item.source_path or not Path(item.source_path).is_file():
                reason = 'source_file_missing'
            elif hashlib.sha256(Path(item.source_path).read_bytes()).hexdigest() != item.source_sha256:
                reason = 'source_fingerprint_mismatch'
            elif pd.Period(target_month, freq='M').ordinal - pd.Period(item.reference_month, freq='M').ordinal > 6:
                reason = 'stale_reference_period'
            elif (item.status != 'verified' or item.time_basis != 'publication') and not (allow_conditional and item.status == 'conditional'):
                reason = 'unverified_source'
            elif not np.isfinite(float(item.value)):
                reason = 'nonfinite_value'
        if reason:
            if item.feature not in selected:
                values[item.feature] = np.nan
                audit[item.feature] = dict(reason=reason, status='excluded')
            continue
        key = (item.reference_month, publication)
        if item.feature in selected and key < selected[item.feature]:
            continue
        if item.feature in selected and key == selected[item.feature] and values[item.feature] != float(item.value):
            raise ValueError(f'Conflicting same-vintage evidence for {item.feature}')
        selected[item.feature] = key
        values[item.feature] = float(item.value)
        audit[item.feature] = dict(reason='eligible', **asdict(item))
    return values, audit


def vintage_features(target_month, cutoff, records, first_releases):
    """Derive differences within one previously published vintage, never across vintages."""
    expected = str(pd.Period(target_month, freq='M')-1)
    boundary = timestamp(cutoff)
    results = []
    for series in ['payroll','temporary_help']:
        eligible = [r for r in records if r['series']==series and r['vintage_month']==expected
                    and timestamp(r['published_at']) <= boundary]
        if not eligible:
            continue
        latest = max(timestamp(r['published_at']) for r in eligible)
        chosen = [r for r in eligible if timestamp(r['published_at'])==latest]
        values = {}
        for r in chosen:
            if r['reference_month'] in values and values[r['reference_month']] != r['value']:
                raise ValueError('Conflicting vintage observations')
            values[r['reference_month']] = float(r['value'])
        paths={r.get('source_path','') for r in chosen}
        hashes={r['source_sha256'] for r in chosen}
        if len(paths)!=1 or not next(iter(paths), '') or len(hashes)!=1:
            continue
        source_path=next(iter(paths)); fingerprint=next(iter(hashes))
        def emit(name,value,reference):
            results.append(Evidence(name,float(value),reference,chosen[0]['published_at'],chosen[0]['source_url'],fingerprint,source_path=source_path))
        if series=='payroll':
            changes=[]
            for lag in range(1,4):
                ref=str(pd.Period(target_month,freq='M')-lag)
                before=str(pd.Period(ref,freq='M')-1)
                if ref not in values or before not in values:
                    continue
                change=values[ref]-values[before]
                changes.append(change)
                emit(f'payroll_known_lag{lag}',change,ref)
                if ref in first_releases and pd.notna(first_releases[ref]):
                    emit(f'payroll_revision_lag{lag}',change-first_releases[ref],ref)
            if len(changes)==3:
                emit('payroll_known_mean3',np.mean(changes),expected)
        else:
            refs=[str(pd.Period(expected,freq='M')-lag) for lag in range(3)]
            if refs[0] in values:
                emit('ces_temp_help_employment_latest',values[refs[0]],expected)
            if all(ref in values for ref in refs[:2]):
                emit('ces_temp_help_employment_previous',values[refs[1]],refs[1])
                emit('ces_temp_help_employment_change',values[refs[0]]-values[refs[1]],expected)
            if all(ref in values for ref in refs):
                emit('ces_temp_help_employment_3m_avg',np.mean([values[ref] for ref in refs]),expected)
    return results


def score(actual, forecast, consensus):
    y,p,c = [np.asarray(x,dtype=float) for x in (actual,forecast,consensus)]
    if not len(y) or not (len(y)==len(p)==len(c)) or not all(np.isfinite(x).all() for x in (y,p,c)):
        raise ValueError('Metrics require equal-length finite observations')
    error=p-y
    surprise=y-c
    return dict(months=len(y),mae=float(abs(error).mean()),rmse=float(np.sqrt(np.mean(error**2))),bias=float(error.mean()),
                payroll_sign_accuracy_pct=float(100*np.mean(np.sign(y)==np.sign(p))),
                surprise_direction_accuracy_pct=float(100*np.mean(np.sign(surprise)==np.sign(p-c))),
                always_beat_accuracy_pct=float(100*np.mean(surprise>0)),always_miss_accuracy_pct=float(100*np.mean(surprise<0)),
                upside_predictions=int((p>c).sum()),downside_predictions=int((p<c).sum()))


def select_validation(rows, candidates):
    validation=rows[rows.target_month.between('2021-01','2023-12')]
    if validation.empty:
        raise ValueError('No validation observations')
    return min(candidates,key=lambda name:(float(abs(validation[name]-validation.actual).mean()),name))


def promotion_decision(candidate, baselines, live_contract_complete, min_improvement=0.5):
    reasons=[]
    if not live_contract_complete:
        reasons.append('Live feature evidence is incomplete')
    if not baselines:
        reasons.append('No comparison baselines')
    for baseline,periods in baselines.items():
        for period in sorted(set(periods)|{'overall','recent'}):
            for metric in ['mae','rmse']:
                proposed=candidate.get(period,{}).get(metric,np.nan)
                reference=periods.get(period,{}).get(metric,np.nan)
                if not np.isfinite(proposed) or not np.isfinite(reference) or proposed>reference+1e-9:
                    reasons.append(f'{period} {metric} regresses against {baseline}')
        proposed=candidate.get('overall',{}).get('mae',np.nan)
        reference=periods.get('overall',{}).get('mae',np.nan)
        if not np.isfinite(proposed) or not np.isfinite(reference) or reference-proposed<min_improvement:
            reasons.append(f'Overall MAE improvement against {baseline} is below {min_improvement} thousand jobs')
    return dict(promote=not reasons,reasons=reasons,min_mae_improvement_thousands=min_improvement)
