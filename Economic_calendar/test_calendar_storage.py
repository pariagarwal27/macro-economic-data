import sqlite3
import unittest
from db import load_calendar_to_db as loader
from merge_all_calendars import normalize_record

class CalendarStorageTests(unittest.TestCase):
    def test_fetch_failure_keeps_last_confirmed_schedule_and_marks_it_stale(self):
        prior = {'metric_id':'us-cpi','next_release_date':'2026-10-14','next_release_at':'2026-10-14T08:30:00-04:00','official_source':'https://www.bls.gov/cpi/','official_evidence':'Confirmed schedule','updated_at':'2026-10-06T12:00:00Z'}
        failed = {'metric_id':'us-cpi','status':'source_error','next_release_date':None,'next_release_at':None}
        retained = loader.retain_confirmed_schedule(failed,prior)
        self.assertEqual(retained['next_release_at'],prior['next_release_at'])
        self.assertEqual(retained['status'],'source_error')
        self.assertEqual(retained['updated_at'],prior['updated_at'])

    def test_deadline_survives_merge_and_storage_without_becoming_exact(self):
        record = normalize_record('Special US Macro', {'metric_id':'us-sticky-cpi','next_release_date':'2026-10-14','release_deadline_at':'2026-10-14T11:00:00-04:00','release_time_kind':'by'})
        stored = loader.normalize(record)
        self.assertIsNone(stored['next_release_at'])
        self.assertEqual(stored['release_deadline_at'], '2026-10-14T11:00:00-04:00')
        self.assertEqual(stored['release_time_kind'], 'by')

    def test_refresh_keeps_previous_scheduled_event(self):
        db = sqlite3.connect(':memory:')
        loader.ensure_table(db)
        db.execute("INSERT INTO calendar(metric_id,next_release_date,next_release_at,status) VALUES ('us-cpi','2026-10-06','2026-10-06T08:30:00-04:00','official_date')")
        loader.archive_calendar(db)
        loader.archive_calendar(db)
        self.assertEqual(db.execute('SELECT metric_id,next_release_date FROM calendar_history').fetchall(), [('us-cpi','2026-10-06')])
        db.close()

if __name__ == '__main__': unittest.main()
