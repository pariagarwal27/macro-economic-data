"""Official EA release fixtures: aggregate flash availability and elapsed events."""
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

import fetch_ecb_calendar as ecb
import fetch_eurostat_calendar as eurostat


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 19, 12, tzinfo=timezone.utc)


def event(day, title, release_at=None):
    return {
        "summary": title, "release_date": day,
        "release_date_obj": date.fromisoformat(day),
        "release_at": release_at, "url": "", "description": "",
    }


class EAAnnouncementTests(unittest.TestCase):
    def test_all_six_displayed_aggregates_use_announced_flash(self):
        # Official HICP metadata publishes annual AND monthly rates for
        # all-items, ex-energy/food and services at the flash stage.
        fixtures = [event("2026-11-18", "Inflation (HICP)"),
                    event("2026-11-04", "Flash estimate inflation euro area")]
        with patch.object(eurostat, "datetime", FixedDateTime):
            for metric_id in ("ea-hicp-yoy", "ea-hicp-mom", "ea-core-hicp-yoy",
                              "ea-core-hicp-mom", "ea-services-hicp-yoy", "ea-services-hicp-mom"):
                family = eurostat.METRIC_FAMILY[metric_id]
                result = eurostat.find_next_release(fixtures, family, eurostat.RELEASE_FAMILIES[family])
                self.assertEqual(result["next_release"], "2026-11-04", metric_id)

    def test_final_family_keeps_full_data_release(self):
        fixtures = [event("2026-11-04", "Flash estimate inflation euro area"),
                    event("2026-11-18", "Inflation (HICP)")]
        with patch.object(eurostat, "datetime", FixedDateTime):
            result = eurostat.find_next_release(fixtures, "HICP", eurostat.RELEASE_FAMILIES["HICP"])
        self.assertEqual(result["next_release"], "2026-11-18")

    def test_elapsed_timed_eurostat_event_is_not_next_release(self):
        fixtures = [event("2026-10-19", "Inflation (HICP)", "2026-10-19T11:00:00+02:00"),
                    event("2026-11-18", "Inflation (HICP)")]
        with patch.object(eurostat, "datetime", FixedDateTime):
            result = eurostat.find_next_release(fixtures, "HICP", eurostat.RELEASE_FAMILIES["HICP"])
        self.assertEqual(result["next_release"], "2026-11-18")

    def test_elapsed_ewt_event_does_not_hide_future_event(self):
        fixture = ("All times are local to Frankfurt am Main. "
                   "19/10/2026 10:00 ECB Wage Tracker (Dataset: EWT) "
                   "04/11/2026 10:00 ECB Wage Tracker (Dataset: EWT)")
        with patch.object(ecb, "fetch_text", return_value=fixture), patch.object(ecb, "datetime", FixedDateTime):
            result = ecb.fetch_wage_tracker()
        self.assertEqual(result["next_release"], "2026-11-04")

    def test_valid_calendar_without_ewt_is_successful_source_check(self):
        fixture = "All times are local to Frankfurt am Main. 20/11/2026 11:00 Euro Area Indicator of Negotiated Wage Rates (Dataset: INW)"
        with patch.object(ecb, "fetch_text", return_value=fixture):
            result = ecb.fetch_wage_tracker()
        self.assertEqual(result["status"], "not_announced")
        self.assertTrue(result.get("source_checked"))
        self.assertIsNone(result["next_release"])

    def test_ecb_error_page_is_fetch_failure_not_not_announced(self):
        with patch.object(ecb, "fetch_text", return_value="Service unavailable"):
            result = ecb.fetch_wage_tracker()
        self.assertEqual(result["status"], "error")
        self.assertFalse(result.get("source_checked"))


if __name__ == "__main__":
    unittest.main()
