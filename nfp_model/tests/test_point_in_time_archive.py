import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from point_in_time_archive import archive_observation, load_snapshot


class ArchiveTests(unittest.TestCase):
    def test_snapshot_excludes_late_capture_and_checks_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.txt'
            source.write_text('official evidence')
            record = dict(feature='strike_workers', value=1000, reference_month='2026-10',
                          published_at='2026-10-15T12:00:00Z', source_url='https://example.org/report')
            archive_observation(root / 'archive', source, record, '2026-10-16T12:00:00Z')
            self.assertEqual(load_snapshot(root / 'archive', '2026-10-16T11:00:00Z'), [])
            self.assertEqual(len(load_snapshot(root / 'archive', '2026-10-17T00:00:00Z')), 1)
            next((root / 'archive' / 'objects').iterdir()).write_text('changed')
            with self.assertRaises(ValueError):
                load_snapshot(root / 'archive', '2026-10-17T00:00:00Z')

    def test_rejects_nonfinite_and_naive_times(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'x'; source.write_text('x')
            with self.assertRaises(ValueError):
                archive_observation(Path(directory) / 'archive', source, dict(feature='x', value=float('nan'), reference_month='2026-10', published_at='2026-10-01', source_url='https://example.org'), '2026-10-02T00:00:00Z')

if __name__ == '__main__':
    unittest.main()
