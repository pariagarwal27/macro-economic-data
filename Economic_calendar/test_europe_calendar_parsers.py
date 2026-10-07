import unittest
from datetime import date
from unittest.mock import patch

import fetch_boe_calendar as boe
import fetch_ecb_calendar as ecb
import fetch_ons_calendar as ons
import fetch_eurostat_calendar as eurostat


class EuropeCalendarTests(unittest.TestCase):
    def test_ecb_catalog_expectation_metrics_are_covered(self):
        expected = {
            'ea-safe-input-cost-exp-1y': 'SAFE',
            'ea-safe-selling-price-exp-1y': 'SAFE',
            'ea-spf-current-year': 'SPF',
            'ea-spf-hicp-1y': 'SPF',
            'ea-wage-tracker': 'WAGE_TRACKER',
            'ea-wage-tracker-ex-oneoff': 'WAGE_TRACKER',
        }
        for metric_id, family in expected.items():
            self.assertIn(metric_id, ecb.ECB_METRICS)
            self.assertEqual(ecb.METRIC_FAMILY[metric_id], family)

    def test_all_ons_metric_families_have_release_queries(self):
        self.assertFalse(set(ons.METRIC_FAMILY.values()) - set(ons.RELEASE_FAMILIES))

    def test_ons_awe_matches_official_combined_labour_release(self):
        import re
        self.assertIsNotNone(re.search(ons.RELEASE_FAMILIES['AWE']['title_regex'], 'UK Labour Market: October 2026', re.I))

    def test_safe_cannot_borrow_previous_events_datetime(self):
        text = ('25/10/2099 12:00 Other statistics (Dataset: OTHER) '
                '26/10/2099 10:00 Survey on the access to finance of enterprises (Dataset: SAFE)')
        with patch.object(ecb, 'fetch_text', return_value=text):
            result = ecb.fetch_safe()
        self.assertEqual(result['next_release'], '2099-10-26')
        self.assertIn('T10:00:00', result['next_release_at'])

    def test_market_data_does_not_invent_release_date(self):
        result = ecb.fetch_inflation_compensation()
        self.assertIsNone(result['next_release'])
        self.assertIsNone(result.get('next_release_at'))

    def test_wage_tracker_does_not_borrow_negotiated_wages_date(self):
        text = '20/11/2099 11:00 Euro Area Indicator of Negotiated Wage Rates (Dataset: INW)'
        with patch.object(ecb, 'fetch_text', return_value=text):
            result = ecb.fetch_wage_tracker()
        self.assertEqual(result['status'], 'not_announced')
        self.assertIsNone(result['next_release'])

    def test_wage_tracker_matches_own_official_event(self):
        text = '04/11/2099 10:00 ECB Wage Tracker (Dataset: EWT)'
        with patch.object(ecb, 'fetch_text', return_value=text):
            result = ecb.fetch_wage_tracker()
        self.assertEqual(result['next_release'], '2099-11-04')
        self.assertIn('T10:00:00', result['next_release_at'])

    def test_boe_does_not_accept_unrelated_iso_date(self):
        self.assertIsNone(boe.explicit_release_date('Event venue booked 2099-11-01'))

    def test_boe_does_not_synthesize_unverified_standard_time(self):
        with patch.object(boe, 'fetch_html', return_value='<h2>Will be published on 30 October 2099.</h2>'):
            result = boe.fetch_explicit_next_date_from_page('https://www.bankofengland.co.uk/test', 'DMP')
        self.assertEqual(result['date'], date(2099, 10, 30))
        self.assertIsNone(result['release_at'])

    def test_boe_decimal_time_is_not_truncated_at_sentence_period(self):
        html = '<h2>Will be published on 30 October 2099 at 9.30am.</h2>'
        with patch.object(boe, 'fetch_html', return_value=html):
            result = boe.fetch_explicit_next_date_from_page('https://www.bankofengland.co.uk/test', 'AGENTS')
        self.assertIn('T09:30:00', result['release_at'])

    def test_agents_sitemap_matches_official_apostrophe(self):
        html = '<a href="/agents-summary/2099/october-2099">Agents\' summary of business conditions - October 2099</a>'
        expected = {'date': date(2099, 10, 30), 'evidence': 'Published on 30 October 2099.'}
        with patch.object(boe, 'fetch_html', return_value=html), patch.object(boe, 'fetch_explicit_next_date_from_page', return_value=expected):
            self.assertIsNotNone(boe.fetch_agents_date())

    def test_latest_family_passes_family_without_name_error(self):
        expected = {'date': date(2099, 10, 30), 'source_url': 'https://www.bankofengland.co.uk/test', 'evidence': None}
        with patch.object(boe, 'latest_boe_links', return_value=[{'title': 'DMP October 2099', 'url': expected['source_url']}]), patch.object(boe, 'fetch_explicit_next_date_from_page', return_value=expected):
            self.assertEqual(boe.fetch_latest_family_explicit_date([['DMP']], family='DMP')['date'], expected['date'])

    def test_lfs_date_only_is_not_euroindicator_news_time(self):
        self.assertIsNone(eurostat.resolve_release_at({'release_date': '2099-10-30'}, 'LFS_MAIN_INDICATORS'))

    def test_hicp_full_release_does_not_match_flash_estimate(self):
        regex = eurostat.RELEASE_FAMILIES['HICP']['event_regex']
        self.assertIsNone(regex.search('Inflation (HICP) - flash estimate'))
        self.assertIsNotNone(regex.search('Inflation (HICP)'))

    def test_ecfin_esi_uses_second_column_not_flash_consumer_date(self):
        text = ('Publication dates 2099 Flash Consumer Confidence Indicator '
                'Business and consumer survey results (incl. ESI, EEI, EUI, sectoral CIs) '
                'October 22 October 2099 16h00 October 1) 29 October 2099 11h00')
        result = eurostat.parse_ecfin_schedule(text, today=date(2099, 10, 1))
        self.assertEqual(result, (date(2099, 10, 29), '11:00'))

    def test_ecfin_unknown_pdf_layout_rejected(self):
        self.assertIsNone(eurostat.parse_ecfin_schedule('Next update: Flash Consumer Confidence Indicator - 22 October 2099.'))


if __name__ == '__main__':
    unittest.main()
