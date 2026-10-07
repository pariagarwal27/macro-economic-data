import unittest
from datetime import date
from unittest.mock import patch

import fetch_pmi_calendar as pmi
import fetch_census_retail_calendar as retail
import fetch_bea_calendar as bea
import fetch_fred_calendar as fred


class CalendarParserTests(unittest.TestCase):
    def test_ism_official_fallback_keeps_exact_title_and_dst(self):
        html = '<table><tr><td>02 <a>ISM Manufacturing</a> (10:00)</td><td>04 <a>ISM Non-Manufacturing</a> (10:00)</td></tr></table>'
        with patch.object(pmi, 'fetch', return_value=html):
            result = pmi.parse_ism_nyfed(today=date(2026, 11, 1))
        self.assertEqual(result['us-ism-manufacturing-pmi']['next_release_at'], '2026-11-02T10:00:00-05:00')
        self.assertEqual(result['us-ism-services-pmi']['next_release'], '2026-11-04')
        self.assertIn('newyorkfed.org', result['us-ism-services-pmi']['official_source'])

    def test_ism_selects_earliest_future(self):
        html = '<table><tr><td>November 2099</td><td>2</td><td>4</td></tr><tr><td>December 2099</td><td>1</td><td>3</td></tr></table>'
        with patch.object(pmi, 'fetch', return_value=html):
            self.assertEqual(pmi.parse_ism()['us-ism-manufacturing-pmi']['next_release'], '2099-11-02')

    def test_sp_daily_blocks_keep_each_products_time_and_year(self):
        html = '<h2>2099</h2><p>November 2 00:30 UTC S&amp;P Global Japan Manufacturing PMI 09:30 UTC S&amp;P Global UK Manufacturing PMI 14:45 UTC S&amp;P Global US Manufacturing PMI</p><p>November 4 09:00 UTC S&amp;P Global Eurozone Composite PMI 09:30 UTC S&amp;P Global UK Services PMI</p>'
        with patch.object(pmi, 'fetch', return_value=html):
            result = pmi.parse_sp()
        self.assertEqual(result['us-sp-global-manufacturing-pmi']['next_release_at'], '2099-11-02T14:45:00+00:00')
        self.assertEqual(result['uk-sp-global-manufacturing-pmi']['next_release_at'], '2099-11-02T09:30:00+00:00')
        self.assertEqual(result['ea-sp-global-services-pmi']['next_release_at'], '2099-11-04T09:00:00+00:00')
        self.assertEqual(result['uk-sp-global-composite-pmi']['next_release_at'], '2099-11-04T09:30:00+00:00')

    def test_retail_section_heading_and_header_time(self):
        html = '<h2>Advance Monthly Retail Trade Report</h2><table><tr><td>Data Month</td><td>Release Date at 8:30 am</td></tr><tr><td>September 2099</td><td>October 15, 2099</td></tr><tr><td>December 2099</td><td>To be announced at a later date</td></tr></table><h2>Monthly Retail Trade Report</h2><table><tr><td>September 2099</td><td>October 16, 2099</td></tr></table>'
        result = retail.extract_from_release_schedule(html)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['date'], date(2099, 10, 15))
        self.assertEqual(result[0]['release_time'], '08:30')

    def test_retail_plain_text_fallback_parses_full_date(self):
        html = '<h2>Advance Monthly Retail Trade Report</h2><p>Release Date at 8:30 am September 2099 October 15, 2099</p><h2>Monthly Retail Trade Report</h2>'
        result = retail.extract_from_plain_text(html)
        self.assertEqual(result[0]['date'], date(2099, 10, 15))

    def test_bea_national_gdp_excludes_regional_products(self):
        schedule = [{'date': '2099-12-02', 'text': 'GDP by County and Personal Income by County, 2098'}, {'date': '2099-12-23', 'text': 'GDP (Third Estimate), Industries, Corporate Profits, State GDP, and State Personal Income'}]
        self.assertEqual(bea.find_next_release(schedule, 'GDP / NIPA')['date'], '2099-12-23')

    def test_census_m3_families_and_unpublished_dates(self):
        html = '<table><tr><td>Survey Month</td><td>Advance Report on Durable Goods (8:30 a.m. release time)</td><td>Full Report (10:00 a.m. release time)</td></tr><tr><td>September 2099</td><td>10/27/2099</td><td>11/3/2099</td></tr><tr><td>November 2099</td><td>12/23/2099</td><td>TBD</td></tr></table>'
        result = fred.parse_census_m3_schedule(html, today=date(2099, 10, 6))
        self.assertEqual(result['Advance Report on Durable Goods']['next_release_at'], '2099-10-27T08:30:00-04:00')
        self.assertEqual(result["Manufacturers' Shipments, Inventories, and Orders"]['next_release_at'], '2099-11-03T10:00:00-05:00')
        self.assertNotIn("Manufacturers' Shipments, Inventories, and Orders", fred.parse_census_m3_schedule(html, today=date(2099, 12, 4)))

    def test_fred_full_report_time_is_official_ten(self):
        self.assertEqual(fred.BLS_RELEASE_TIMES["Manufacturers' Shipments, Inventories, and Orders"], '10:00')

    def test_fred_refresh_selects_min_future_and_requests_scheduled_dates(self):
        with patch.object(fred, 'fred_get', return_value={'release_dates': [{'date': '2099-12-01'}, {'date': '2000-01-01'}, {'date': '2099-11-01'}]}) as api:
            self.assertEqual(fred.fetch_next_release(1), '2099-11-01')
        self.assertEqual(api.call_args.args[1]['include_release_dates_with_no_data'], 'true')

    def test_missing_calendar_markup_is_fetch_failure(self):
        with patch.object(pmi, 'fetch', return_value='<html>Please login</html>'):
            with self.assertRaises(RuntimeError):
                pmi.parse_ism()
            with self.assertRaises(RuntimeError):
                pmi.parse_sp()


if __name__ == '__main__':
    unittest.main()
