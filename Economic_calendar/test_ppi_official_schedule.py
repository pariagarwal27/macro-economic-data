import unittest
from datetime import date
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_fred_calendar import BLS_PPI_SCHEDULE_URL, parse_bls_ppi_schedule


class OfficialPpiScheduleTests(unittest.TestCase):
    def test_bls_parser_uses_next_official_date_and_time(self):
        html = """
        <table><tr><th>Reference Month</th><th>Release Date</th><th>Release Time</th></tr>
        <tr><td>September 2026</td><td>Oct. 15, 2026</td><td>08:30 AM</td></tr>
        <tr><td>October 2026</td><td>Nov. 13, 2026</td><td>08:30 AM</td></tr></table>
        """
        result = parse_bls_ppi_schedule(html, today=date(2026, 10, 16))["PPI"]
        self.assertEqual(result["next_release"], "2026-11-13")
        self.assertTrue(result["next_release_at"].startswith("2026-11-13T08:30:00"))
        self.assertEqual(result["official_source"], BLS_PPI_SCHEDULE_URL)

    def test_no_unpublished_future_date_is_invented(self):
        self.assertEqual(parse_bls_ppi_schedule("<table></table>", today=date(2026, 10, 16)), {})


if __name__ == "__main__":
    unittest.main()
