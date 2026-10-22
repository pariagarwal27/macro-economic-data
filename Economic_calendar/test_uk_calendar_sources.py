import unittest
from datetime import date, datetime, timezone
from unittest.mock import Mock, patch

import requests
import fetch_boe_calendar as boe
import fetch_ons_calendar as ons


def ons_release(period, timestamp, **flags):
    return {"uri": "/releases/gdpmonthlyestimateuk" + period,
            "description": {"title": "GDP monthly estimate, UK: " + period,
                            "release_date": timestamp, "published": False,
                            "cancelled": False, **flags}}


class UkCalendarSourceTests(unittest.TestCase):
    def fetch_ons(self, releases):
        response = Mock()
        response.json.return_value = {"releases": releases}
        with patch.object(ons.requests, "get", return_value=response):
            return ons.fetch_family_release("GDP_MONTHLY", ons.RELEASE_FAMILIES["GDP_MONTHLY"])

    def test_ons_skips_elapsed_timestamp_even_when_same_day(self):
        now = datetime(2099, 10, 19, 8, tzinfo=timezone.utc)
        with patch.object(ons, "datetime") as clock:
            clock.now.return_value = now
            clock.fromisoformat.side_effect = datetime.fromisoformat
            result = self.fetch_ons([
                ons_release("August 2099", "2099-10-19T06:00:00Z"),
                ons_release("September 2099", "2099-11-12T07:00:00Z"),
            ])
        self.assertEqual(result["next_release"], "2099-11-12")

    def test_ons_rejects_cancelled_and_published_records(self):
        result = self.fetch_ons([
            ons_release("July 2099", "2099-09-12T07:00:00Z", cancelled=True),
            ons_release("August 2099", "2099-10-15T07:00:00Z", published=True),
            ons_release("September 2099", "2099-11-12T07:00:00Z"),
        ])
        self.assertEqual(result["next_release"], "2099-11-12")

    def test_ons_preserves_official_release_url_in_metric_output(self):
        result = self.fetch_ons([ons_release("September 2099", "2099-11-12T07:00:00Z")])
        metrics = ons.build_metric_results({"GDP_MONTHLY": result})
        row = next(item for item in metrics if item["metric_id"] == "uk-gdp-mom")
        self.assertEqual(row.get("official_source"), "https://www.ons.gov.uk/releases/gdpmonthlyestimateukSeptember 2099")

    def test_maps_historical_sitemap_is_checked_without_calculating_mpc_date(self):
        html = '<a href="/markets/market-intelligence/survey-results/2025/market-participants-survey-results-september-2025">Market Participants Survey results – September 2025</a>'
        with patch.object(boe, "fetch_html", return_value=html):
            result = boe.fetch_maps_date()
        self.assertEqual(result["status"], "not_announced")
        self.assertIsNone(result["date"])
        self.assertEqual(result["source_url"], boe.BOE_MARKETS_SITEMAP)

    def test_boe_fetch_failure_is_not_not_announced(self):
        with patch.object(boe, "fetch_ias_date", side_effect=requests.ConnectionError("offline")), patch.object(boe, "fetch_dmp_date"), patch.object(boe, "fetch_agents_date"), patch.object(boe, "fetch_maps_date"), patch.object(boe, "fetch_citi_yougov_date"):
            rows = boe.build_results(boe.fetch_family_dates())
        row = next(item for item in rows if item["family"] == "IAS")
        self.assertEqual(row["status"], "fetch_failed")
        self.assertIn("offline", row["error"])

    def test_citi_publisher_listing_without_survey_is_unknown(self):
        with patch.object(boe, "fetch_html", return_value='<a href="/en-gb/content/economy">Economy and business</a>'):
            result = boe.fetch_citi_yougov_date()
        self.assertEqual(result["status"], "source_unavailable")
        self.assertIsNone(result["date"])

    def test_boe_expired_same_day_timed_release_not_upcoming(self):
        html = '<p>Will be published on 19 October 2099 at 7:00am.</p>'
        with patch.object(boe, "fetch_html", return_value=html), patch.object(boe, "datetime") as clock:
            clock.now.return_value = datetime(2099, 10, 19, 8, tzinfo=timezone.utc)
            clock.strptime.side_effect = datetime.strptime
            clock.fromisoformat.side_effect = datetime.fromisoformat
            result = boe.fetch_explicit_next_date_from_page("https://www.bankofengland.co.uk/test")
        self.assertIsNone(result["date"])


if __name__ == "__main__":
    unittest.main()
