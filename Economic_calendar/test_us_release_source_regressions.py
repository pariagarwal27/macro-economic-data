import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

import fetch_fred_calendar as bls
import fetch_special_us_macro_calendar_v2 as special
import fetch_census_retail_calendar as retail


class SourceRegressionTests(unittest.TestCase):
    def test_cpi_official_table_ignores_navigation_dates_and_elapsed_release(self):
        html = '''<nav>October 20, 2026</nav><table><tr><th>Reference Month</th><th>Release Date</th><th>Release Time</th></tr>
        <tr><td>September 2026</td><td>Oct. 14, 2026</td><td>08:30 AM</td></tr>
        <tr><td>October 2026</td><td>Nov. 10, 2026</td><td>08:30 AM</td></tr></table>'''
        value = bls.parse_bls_schedule(html, 'CPI', now=datetime(2026, 10, 14, 13, tzinfo=timezone.utc))['CPI']
        self.assertEqual(value['next_release'], '2026-11-10')
        self.assertEqual(value['next_release_at'], '2026-11-10T08:30:00-05:00')

    def test_fred_missing_key_does_not_prevent_official_fetches(self):
        with patch.object(bls, 'find_release_ids', side_effect=RuntimeError('missing key')), patch.object(bls, 'requests') as requests, patch.object(bls, 'fetch_official_family_dates', return_value={'CPI': {'next_release': '2026-11-10'}}):
            requests.get.side_effect = OSError('offline')
            self.assertEqual(bls.collect_family_dates()['CPI']['next_release'], '2026-11-10')

    def test_claims_uses_published_holiday_exception_and_central_timezone(self):
        html = '''<table><tr><td>Thursday November 19, 2026</td></tr><tr><td>7:30 am</td><td><a href="/release?rid=180">Unemployment Insurance Weekly Claims Report</a></td></tr>
        <tr><td>Wednesday November 25, 2026</td></tr><tr><td>7:30 am</td><td><a href="/release?rid=180">Unemployment Insurance Weekly Claims Report</a></td></tr></table>'''
        value = special.parse_claims_calendar(html, now=datetime(2026, 11, 19, 14, tzinfo=timezone.utc))
        self.assertEqual(value['date'], '2026-11-25')
        self.assertEqual(value['next_release_at'], '2026-11-25T07:30:00-06:00')

    def test_claims_does_not_invent_thursday_if_calendar_missing(self):
        with patch.object(special, 'fetch', return_value='<table></table>'):
            with self.assertRaisesRegex(RuntimeError, 'published'):
                special.weekly_claims_result()

    def test_wage_source_is_checked_and_no_exact_date_is_inferred(self):
        with patch.object(special, 'fetch', return_value='Updated: October 08, 2026. Usually by the second Friday of the month.') as fetch:
            value = special.fetch_atlanta_wage()
        fetch.assert_called_once_with(special.URLS['ATLANTA_WAGE'])
        self.assertIsNone(value['date'])
        self.assertEqual(value['status'], 'not_announced')

    def test_retail_skips_todays_elapsed_release(self):
        candidates = [{'date': date(2026, 10, 15), 'release_time': '08:30'}, {'date': date(2026, 11, 17), 'release_time': '08:30'}]
        value = retail.choose_next(candidates, now=datetime(2026, 10, 15, 13, tzinfo=timezone.utc))
        self.assertEqual(value['date'], date(2026, 11, 17))

    def test_sofie_reads_primary_source_and_reports_fetch_failure(self):
        with patch.object(special, 'fetch', side_effect=OSError('offline')):
            with self.assertRaises(OSError):
                special.sofie_result()

    def test_sofie_url_slug_is_not_an_announced_publication_date(self):
        with patch.object(special, 'fetch', side_effect=[
            'Survey of Firms Inflation Expectations. Quarterly survey.',
            '/collections/press-releases/2099/pr-20991029-survey-ceo-inflation-expectations',
            'Survey of Firms Inflation Expectations. Survey conducted during October.',
        ]):
            self.assertIsNone(special.sofie_result()['date'])


if __name__ == '__main__':
    unittest.main()
