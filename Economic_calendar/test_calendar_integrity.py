import unittest
from merge_all_calendars import normalize_record, complete_catalog
from release_time_utils import extract_release_time, clean_datetime_value, combine_date_time


class CalendarIntegrityTests(unittest.TestCase):
    def test_hour_only_time(self):
        self.assertEqual(extract_release_time("Published at 8 AM Eastern"), "08:00")
        self.assertEqual(extract_release_time("12 p.m."), "12:00")

    def test_invalid_am_pm_time(self):
        self.assertIsNone(extract_release_time("13:30 PM"))

    def test_unknown_timezone_is_not_an_exact_timestamp(self):
        self.assertIsNone(clean_datetime_value("2026-10-06T11:00:00"))
        self.assertIsNone(clean_datetime_value("2026-10-06"))
        self.assertEqual(clean_datetime_value("2026-10-06T11:00:00-04:00"), "2026-10-06T11:00:00-04:00")

    def test_market_update_is_not_a_scheduled_release(self):
        item = normalize_record("ECB", {"metric_id": "ea-inflation-comp-1y", "next_release": "2026-10-07", "update_type": "daily_business_day", "success": True})
        self.assertIsNone(item["next_release"])
        self.assertEqual(item["release_status"], "daily_series")

    def test_timezone_dst(self):
        self.assertEqual(combine_date_time("2026-11-05", "08:30", "America/New_York"), "2026-11-05T08:30:00-05:00")
        self.assertEqual(combine_date_time("2026-10-06", "08:30", "America/New_York"), "2026-10-06T08:30:00-04:00")

    def test_catalog_ids_and_missing_records(self):
        item = normalize_record("Special US Macro", {"metric_id": "us-cleveland-inflation-exp-1y", "next_release": "2026-10-14"})
        self.assertEqual(item["metric_id"], "us-cleveland-exp-inf-1y")
        metrics = complete_catalog([item], [{"id": "us-cleveland-exp-inf-1y", "name": "Expected inflation", "source": "cleveland"}, {"id": "missing", "name": "Unannounced", "source": "ecb"}])
        self.assertEqual(len(metrics), 2)
        self.assertIsNone(metrics[1]["next_release"])
        self.assertEqual(metrics[1]["release_status"], "not_announced")


if __name__ == "__main__":
    unittest.main()
