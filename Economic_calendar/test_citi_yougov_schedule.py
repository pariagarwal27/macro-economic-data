import unittest
from datetime import date
from unittest.mock import patch
import fetch_boe_calendar as boe


class CitiYouGovScheduleTests(unittest.TestCase):
    def test_search_discovers_explicit_official_survey_next_date(self):
        publication = 'https://yougov.com/en-gb/articles/99999-citigroup-inflation-tracker'
        def fetch(url):
            if '/search?' in url:
                return f'<a href="{publication}">Citi/YouGov inflation expectations</a>'
            if url == publication:
                return '<h1>Citi/YouGov UK Inflation Tracker</h1><p>The next release date will be 26 November 2099 at 4:00pm.</p>'
            return '<h1>Economy</h1>'
        with patch.object(boe, 'fetch_html', side_effect=fetch):
            result = boe.fetch_citi_yougov_date()
        self.assertEqual(result['date'], date(2099, 11, 26))
        self.assertEqual(result['release_at'], '2099-11-26T16:00:00+00:00')
        self.assertEqual(result['source_url'], publication)

    def test_unrelated_yougov_inflation_article_is_not_survey_calendar(self):
        html = '<a href="/en-gb/articles/1-how-yougov-consumers-see-inflation">YouGov consumers and inflation</a>'
        def fetch(url):
            return '<p>Published on 26 November 2099.</p>' if '/articles/' in url else html
        with patch.object(boe, 'fetch_html', side_effect=fetch):
            result = boe.fetch_citi_yougov_date()
        self.assertIsNone(result['date'])


if __name__ == '__main__': unittest.main()
