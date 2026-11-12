import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

import pandas as pd


spec = importlib.util.spec_from_file_location("market_worker_under_test", Path(__file__).with_name("lseg_worker.py"))
worker = importlib.util.module_from_spec(spec)
sdk = types.ModuleType("lseg.data")
sdk.HeaderType = types.SimpleNamespace(NAME="field-names")
with patch.dict(sys.modules, {"lseg": types.ModuleType("lseg"), "lseg.data": sdk}):
    spec.loader.exec_module(worker)


class MarketHistoryTests(unittest.TestCase):
    def setUp(self):
        worker._session_open = True

    def test_swap_history_preserves_daily_negative_and_zero_midpoints(self):
        frame = pd.DataFrame({"BID": [-0.4, -0.1, 2.0], "ASK": [-0.2, 0.1, 2.2]},
                             index=pd.to_datetime(["2020-03-18", "2020-03-19", "2020-03-20"]))
        sdk.get_history = Mock(return_value=frame)
        points = worker.fetch_history_from_lseg("EUHICP1Y=", "2020-03-01", "2020-03-31")
        self.assertEqual([p["date"] for p in points], ["2020-03-18", "2020-03-19", "2020-03-20"])
        self.assertAlmostEqual(points[0]["value"], -0.3)
        self.assertEqual(points[1]["value"], 0)
        self.assertAlmostEqual(points[2]["value"], 2.1)
        self.assertEqual(sdk.get_history.call_args.kwargs["interval"], "daily")
        self.assertEqual(sdk.get_history.call_args.kwargs["header_type"], "field-names")

    def test_market_history_does_not_treat_volume_as_an_inflation_rate(self):
        sdk.get_history = Mock(return_value=pd.DataFrame({"VOLUME": [42]}, index=pd.to_datetime(["2026-10-29"])))
        self.assertEqual(worker.fetch_history_from_lseg("EUIL5Y5Y=R", "2026-10-01", "2026-10-30"), [])

    def test_market_latest_uses_observation_date_and_not_economic_actual_fields(self):
        sdk.get_data = Mock(side_effect=AssertionError("Swap is not an economic indicator"))
        sdk.get_history = Mock(return_value=pd.DataFrame({"TRDPRC_1": [2.15]}, index=pd.to_datetime(["2026-10-29"])))
        latest = worker.fetch_latest_from_lseg("EUIL5Y5Y=R")
        self.assertEqual(latest["periodDate"], "2026-10-29")
        self.assertEqual(latest["value"], 2.15)
        sdk.get_data.assert_not_called()

    def test_market_history_reads_multiindex_price_fields_and_skips_missing_quotes(self):
        frame = pd.DataFrame([[2.0, 2.2], [float("nan"), float("nan")]],
                             columns=pd.MultiIndex.from_tuples([("EUHICP5Y=", "BID"), ("EUHICP5Y=", "ASK")]),
                             index=pd.to_datetime(["2026-10-28", "2026-10-29"]))
        sdk.get_history = Mock(return_value=frame)
        self.assertEqual(worker.fetch_history_from_lseg("EUHICP5Y=", "2026-10-01", "2026-10-30"),
                         [{"date": "2026-10-28", "value": 2.1}])

    def test_economic_indicator_history_keeps_monthly_value_contract(self):
        sdk.get_history = Mock(return_value=pd.DataFrame({"VALUE": [51.2]}, index=pd.to_datetime(["2026-09-01"])))
        self.assertEqual(worker.fetch_history_from_lseg("USPMI=ECI", "2026-01-01", "2026-10-30"),
                         [{"date": "2026-09-01", "value": 51.2}])
        self.assertEqual(sdk.get_history.call_args.kwargs["interval"], "monthly")

    def test_full_market_history_is_requested_in_bounded_daily_windows(self):
        sdk.get_history = Mock(return_value=pd.DataFrame())
        worker.fetch_history_from_lseg("EUHICP10Y=", "2024-01-01", "2026-10-30")
        self.assertGreater(len(sdk.get_history.call_args_list), 1)
        for call in sdk.get_history.call_args_list:
            start = pd.Timestamp(call.kwargs["start"])
            end = pd.Timestamp(call.kwargs["end"])
            self.assertLessEqual((end - start).days, 365)


if __name__ == "__main__":
    unittest.main()
