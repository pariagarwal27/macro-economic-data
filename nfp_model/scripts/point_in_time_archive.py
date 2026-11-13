"""Content-addressed source capture; timestamps describe capture, not source truth."""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd


def timestamp(value):
    t = pd.Timestamp(value)
    if pd.isna(t) or t.tzinfo is None:
        raise ValueError('Timezone-aware timestamp required')
    return t.tz_convert('UTC')


def archive_observation(root, source, observation, captured_at):
    root, source = Path(root), Path(source)
    captured = timestamp(captured_at)
    published = timestamp(observation['published_at'])
    if published > captured:
        raise ValueError('Publication is later than capture')
    if not observation.get('feature') or not math.isfinite(float(observation['value'])):
        raise ValueError('A finite value and feature are required')
    pd.Period(observation['reference_month'], freq='M')
    if urlparse(observation.get('source_url', '')).scheme not in ('https', 'http'):
        raise ValueError('Source URL required')
    content = source.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    objects, records = root / 'objects', root / 'records'
    objects.mkdir(parents=True, exist_ok=True); records.mkdir(parents=True, exist_ok=True)
    obj = objects / digest
    if obj.exists() and hashlib.sha256(obj.read_bytes()).hexdigest() != digest:
        raise ValueError('Existing object hash mismatch')
    if not obj.exists():
        obj.write_bytes(content)
    record = dict(observation, captured_at=captured.isoformat(), source_sha256=digest,
                  verification_status='source_capture_only')
    encoded = json.dumps(record, sort_keys=True, allow_nan=False).encode('utf-8')
    key = hashlib.sha256(encoded).hexdigest()
    (records / (key + '.json')).write_bytes(encoded)
    return record


def load_snapshot(root, cutoff):
    root, boundary = Path(root), timestamp(cutoff)
    result = []
    for path in sorted((root / 'records').glob('*.json')):
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != path.stem:
            raise ValueError('Record hash mismatch')
        record = json.loads(content)
        blob = root / 'objects' / record['source_sha256']
        if hashlib.sha256(blob.read_bytes()).hexdigest() != record['source_sha256']:
            raise ValueError('Source hash mismatch')
        if timestamp(record['published_at']) <= boundary and timestamp(record['captured_at']) <= boundary:
            result.append(record)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--observation', type=Path, required=True, help='JSON with feature, value, reference_month, published_at and source_url')
    args = parser.parse_args()
    record = archive_observation(args.archive, args.source, json.loads(args.observation.read_text(encoding='utf-8')), datetime.now(timezone.utc).isoformat())
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
