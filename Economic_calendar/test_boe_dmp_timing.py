import unittest
from datetime import date
from unittest.mock import patch

import requests
import fetch_boe_calendar as boe


class DmpTimingTests(unittest.TestCase):
    def resolve(self, day=date(2099, 10, 30), time=None, feed=None):
        page = dict(date=day, release_time=time, release_at=None,
                    source_url=f'{boe.BOE_BASE}/decision-maker-panel/2099/october-2099',
                    evidence='Official publication date.')
        if time:
            page['release_at'] = boe.combine_date_time(day, time, 'Europe/London')
        with patch.object(boe, 'fetch_monthly_boE_page_date', return_value=page), \
                patch.object(boe, 'fetch_html', return_value=feed or '<rss><channel/></rss>'):
            return boe.fetch_dmp_date()

    def test_date_only_dmp_uses_verified_family_time_for_all_metrics(self):
        result = self.resolve()
        self.assertEqual(result['release_at'], '2099-10-30T09:30:00+00:00')
        self.assertIn('Expected', result['evidence'])
        records = [r for r in boe.build_results({'DMP': result}) if r['family'] == 'DMP']
        self.assertEqual(len(records), 6)
        self.assertTrue(all(r['next_release_at'] == result['release_at'] for r in records))

    def test_london_dst_is_recomputed_for_future_release_date(self):
        self.assertEqual(self.resolve(date(2099, 7, 3))['release_at'], '2099-07-03T09:30:00+01:00')

    def test_explicit_publication_time_wins(self):
        self.assertEqual(self.resolve(time='10:15')['release_time'], '10:15')

    def test_official_feed_updates_expected_wall_clock_without_borrowing_other_releases(self):
        feed = '''<rss><channel>
        <item><link>https://www.bankofengland.co.uk/decision-maker-panel/2099/september-2099</link><pubDate>Fri, 02 Oct 2099 10:00:00 +0100</pubDate></item>
        <item><link>https://www.bankofengland.co.uk/monetary-policy-report/2099/october-2099</link><pubDate>Fri, 30 Oct 2099 12:00:00 +0000</pubDate></item>
        </channel></rss>'''
        result = self.resolve(feed=feed)
        self.assertEqual(result['release_at'], '2099-10-30T10:00:00+00:00')
        self.assertIn(boe.BOE_BASE + '/rss/publications', result['evidence'])

    def test_feed_failure_keeps_verified_time(self):
        with patch.object(boe, 'fetch_html', side_effect=requests.ConnectionError('offline')):
            result = boe.apply_dmp_release_time(dict(date=date(2099, 10, 30), release_at=None, evidence='Date.'))
        self.assertEqual(result['release_at'], '2099-10-30T09:30:00+00:00')

    def test_matching_official_feed_entry_confirms_exact_time(self):
        feed = '''<rss><channel><item>
        <link>https://www.bankofengland.co.uk/decision-maker-panel/2099/october-2099</link>
        <pubDate>Fri, 30 Oct 2099 10:15:00 +0000</pubDate>
        </item></channel></rss>'''
        result = self.resolve(feed=feed)
        self.assertEqual(result['release_at'], '2099-10-30T10:15:00+00:00')
        self.assertEqual(result['release_time_kind'], 'exact')

    def test_malformed_feed_keeps_verified_time(self):
        self.assertEqual(self.resolve(feed='<html>Unavailable')['release_time'], '09:30')

    def test_no_announced_date_does_not_create_event(self):
        with patch.object(boe, 'fetch_monthly_boE_page_date', return_value=None):
            self.assertIsNone(boe.fetch_dmp_date())


if __name__ == '__main__':
    unittest.main()
