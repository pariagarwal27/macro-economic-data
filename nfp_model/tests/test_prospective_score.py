import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prospective_score import score_pairs, select_cutoff_forecast, forecasts_from_database
import sqlite3

class ProspectiveTests(unittest.TestCase):
    def test_excludes_late_and_mismatched_or_unverified_actual(self):
        forecast = dict(target_month='2026-09', release_at='2026-10-02T12:30:00Z', cutoff='2026-10-02T00:00:00Z', generated_at='2026-10-01T23:00:00Z', consensus=100, forecast=110)
        actual = dict(target_month='2026-09', release_at='2026-10-02T12:30:00Z', first_print=120, verified=True)
        self.assertEqual(score_pairs([forecast], [actual])['months'], 1)
        self.assertEqual(score_pairs([{**forecast, 'generated_at': '2026-10-02T01:00:00Z'}], [actual])['months'], 0)
        self.assertEqual(score_pairs([forecast], [{**actual, 'verified': False}])['months'], 0)
        self.assertEqual(score_pairs([forecast], [{**actual, 'release_at': '2026-10-03T12:30:00Z'}])['months'], 0)

    def test_duplicate_forecasts_are_rejected(self):
        f = dict(target_month='2026-09', release_at='2026-10-02T12:30:00Z', cutoff='2026-10-02T00:00:00Z', generated_at='2026-10-01T23:00:00Z', consensus=100, forecast=110)
        with self.assertRaises(ValueError): score_pairs([f, f], [])

    def test_selects_latest_snapshot_at_new_york_cutoff(self):
        rows = [dict(created_at='2026-10-02T00:00:00Z', forecast_value=110, consensus_value=100),
                dict(created_at='2026-10-02T00:01:00Z', forecast_value=120, consensus_value=100)]
        chosen = select_cutoff_forecast(rows, '2026-10-02T12:30:00Z')
        self.assertEqual(chosen['forecast_value'], 110)
        self.assertEqual(select_cutoff_forecast(rows, '2026-12-04T13:30:00Z')['forecast_value'], 120)

    def test_database_rejects_snapshots_after_cutoff(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE nfp_forecast_runs (target_month TEXT, release_at TEXT, model_id TEXT, created_at TEXT, forecast_value REAL, consensus_value REAL)')
        db.executemany('INSERT INTO nfp_forecast_runs VALUES (?,?,?,?,?,?)', [('2026-09','2026-10-02T12:30:00Z','test','2026-10-01T23:59:00Z',110,100),('2026-09','2026-10-02T12:30:00Z','test','2026-10-02T00:01:00Z',120,100)])
        records = forecasts_from_database(db, 'test')
        self.assertEqual(records[0]['forecast'], 110)
        self.assertEqual(records[0]['cutoff'], '2026-10-02T00:00:00+00:00')
