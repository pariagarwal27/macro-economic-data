import unittest
from datetime import date
from unittest.mock import patch

import fetch_nyfed_sce_philly_spf_calendar as ny
import fetch_special_us_macro_calendar_v2 as special


class FixedDate(date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 6)


class CalendarParserTests(unittest.TestCase):
    def test_oecd_published_time_rule(self):
        text = 'Dataset update dates 7 October 2026 9 November 2026 OECD CLIs, BCIs and CCIs are updated at 12:00 CET. Countries and area totals covered'
        with patch.object(special, 'fetch', return_value=text):
            value = special.fetch_oecd_cli_bci()
        self.assertEqual(value['next_release_at'], '2026-10-07T12:00:00+01:00')

    def test_gdpnow_published_date_does_not_invent_time(self):
        with patch.object(special, 'fetch', return_value='Next update: October 06, 2026'):
            value = special.fetch_gdpnow()
        self.assertEqual(value['date'], '2026-10-06')
        self.assertIsNone(value['next_release_at'])

    def test_adp_weekly_pulse_is_not_monthly_announcement(self):
        listing = '<a href="https://mediacenter.adp.com/pulse">ADP National Employment Report Preliminary Estimate</a><a href="https://mediacenter.adp.com/report">ADP National Employment Report: Private-Sector Employment Increased</a>'
        report = 'The October 2026 ADP National Employment Report will be released on November 4, 2026 at 8:15 a.m. ET.'
        with patch.object(special, 'fetch', side_effect=[listing, report]) as fetch:
            value = special.fetch_adp()
        self.assertEqual(value['date'], '2026-11-04')
        self.assertEqual(fetch.call_args.args[0], 'https://mediacenter.adp.com/report')

    def test_adp_published_next_monthly_time(self):
        listing = '<a href="https://mediacenter.adp.com/report">ADP National Employment Report: Private-Sector Employment Increased</a>'
        report = 'The October 2026 ADP National Employment Report will be released on November 4, 2026 at 8:15 a.m. ET.'
        with patch.object(special, 'fetch', side_effect=[listing, report]):
            value = special.fetch_adp()
        self.assertEqual(value['next_release_at'], '2026-11-04T08:15:00-05:00')

    def test_michigan_exact_date_time_from_official_calendar(self):
        calendar_html = '<table><tr><td>09<br><a>Michigan Consumer Survey (Preliminary)</a><br>(10:00)</td></tr></table>'
        with patch.object(special, 'fetch', return_value='Next data release: Friday, October 09, 2026'), patch.object(special, 'fetch_nyfed_calendar', return_value=calendar_html):
            value = special.fetch_umich()
        self.assertEqual(value['next_release_at'], '2026-10-09T10:00:00-04:00')

    def test_dallas_exact_date_time_from_official_calendar(self):
        calendar_html = '<table><tr><td>26<br><a>Dallas Fed Manufacturing Survey</a><br>(10:30)</td></tr></table>'
        with patch.object(special, 'fetch', return_value='October Monday, October 26'), patch.object(special, 'fetch_nyfed_calendar', return_value=calendar_html):
            value = special.fetch_dallas()
        self.assertEqual(value['next_release_at'], '2026-10-26T10:30:00-04:00')

    def test_enrichment_does_not_borrow_a_different_date(self):
        calendar_html = '<table><tr><td>23<br><a>Michigan Consumer Survey (Final)</a><br>(10:00)</td></tr></table>'
        with patch.object(special, 'fetch', return_value='Next data release: Friday, October 09, 2026'), patch.object(special, 'fetch_nyfed_calendar', return_value=calendar_html):
            self.assertIsNone(special.fetch_umich()['next_release_at'])

    def setUp(self):
        patcher = patch.object(special, 'date', FixedDate)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_bie_stops_before_article_dates(self):
        html = '<h2>Survey Release Dates</h2><h3>2026</h3><p>October 21 November 18 December 23</p><p><a>Other article</a> October 7, 2026</p>'
        with patch.object(special, 'fetch', return_value=html):
            self.assertEqual(special.fetch_bie()['date'], '2026-10-21')

    def test_model_inflation_expectations_are_separate_from_firm_survey(self):
        family = dict((metric, family) for metric, _, family in special.METRICS)
        self.assertEqual(family['us-cleveland-inflation-exp-1y'], 'CLEVELAND_INFLATION_EXPECTATIONS')

    def test_derived_cpi_does_not_inherit_bls_release_time(self):
        with patch.object(special, 'next_date_from_bls_cpi', return_value={'date': '2026-10-14'}), patch.object(special, 'fetch', return_value='Published by 11:00 a.m. (ET) on the day of the CPI release.'):
            value = special.fetch_cpi_derived('ATLANTA_CPI')
        self.assertEqual(value['date'], '2026-10-14')
        self.assertIsNone(value['next_release_at'])
        self.assertEqual(value['release_deadline_at'], '2026-10-14T11:00:00-04:00')
        self.assertEqual(value['release_time_kind'], 'by')

    def test_deadline_policy_is_refetched_not_hardcoded(self):
        with patch.object(special, 'next_date_from_bls_cpi', return_value={'date': '2026-10-14'}), patch.object(special, 'fetch', return_value='The model results are released before 3 pm on that day.'):
            value = special.fetch_cpi_derived('CLEVELAND_INFLATION_EXPECTATIONS')
        self.assertEqual(value['release_deadline_at'], '2026-10-14T15:00:00-04:00')
        self.assertEqual(value['release_time_kind'], 'before')

    def test_german_fred_series_does_not_borrow_oecd_press_calendar(self):
        with patch.object(special, 'fetch', return_value='Unemployment rates 8 October 2026 GDP 7 October 2026'):
            value = special.fetch_oecd_unemployment()
        self.assertIsNone(value['date'])
        self.assertEqual(value['official_source'], 'https://fred.stlouisfed.org/series/LRHUTTTTDEM156S')

    def test_sce_navigation_does_not_supply_day_or_time(self):
        html = '<nav>6 Survey of Consumer Expectations 10:00</nav><table><tr><td><div>07<br><span><a>Survey of Consumer Expectations</a><br>(11:00)</span></div></td></tr></table>'
        value = ny.extract_family_release(html, 2026, 10, 'SCE')
        self.assertEqual(value['date'], date(2026, 10, 7))
        self.assertEqual(value['release_time'], '11:00')

    def test_release_cannot_take_next_event_time(self):
        html = '<table><tr><td>07<br><a>Survey of Consumer Expectations</a><br><a>Other release</a> (12:00)</td></tr></table>'
        value = ny.extract_family_release(html, 2026, 10, 'SCE')
        self.assertIsNone(value['release_time'])

    def test_sce_module_is_not_core_monthly_release(self):
        html = '<table><tr><td>07<br><a>Survey of Consumer Expectations Labor Market Survey</a> (11:00)</td></tr></table>'
        self.assertIsNone(ny.extract_family_release(html, 2026, 10, 'SCE'))

    def test_fed_missing_day_does_not_take_adjacent_event(self):
        html = '<div class="row"><div class="col-xs-2">9:15 a.m.</div><div class="col-xs-7">G.17 - Industrial Production and Capacity Utilization</div><div class="col-xs-3"></div></div><div class="row">H.6 Money Stock 6</div>'
        with patch.object(special, 'fetch', return_value=html):
            self.assertIsNone(special.fetch_fed_g17()['date'])

    def test_fed_row_carries_published_time(self):
        html = '<div class="row"><div class="col-xs-2">9:15 a.m.</div><div class="col-xs-7">G.17 - Industrial Production and Capacity Utilization</div><div class="col-xs-3">16</div></div>'
        with patch.object(special, 'fetch', return_value=html):
            self.assertEqual(special.fetch_fed_g17()['date'], '2026-10-16')


if __name__ == '__main__':
    unittest.main()
