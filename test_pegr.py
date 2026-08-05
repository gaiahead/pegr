import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from gen_pegr_data import (
    calculate_pegr,
    extract_latest_net_income,
    fair_market_cap,
    implied_earnings_cagr,
    select_statement_row,
)


class PegrCalculationTest(unittest.TestCase):
    def setUp(self):
        self.price = 100.0
        self.shares = 1_000_000_000
        self.income = 10_000_000_000
        self.required_return = 0.10
        self.terminal_pe = 15.0
        self.horizon = 10

    def test_fair_value_is_discounted_terminal_earnings_only(self):
        valuation = fair_market_cap(
            self.income, 8.0, self.required_return, self.terminal_pe, self.horizon,
        )
        expected_earnings = self.income * (1.08 ** self.horizon)
        expected_value = (
            expected_earnings * self.terminal_pe
            / ((1 + self.required_return) ** self.horizon)
        )
        self.assertAlmostEqual(valuation["earnings_10"], expected_earnings)
        self.assertAlmostEqual(valuation["fair_market_cap"], expected_value)
        self.assertEqual(valuation["fair_market_cap"], valuation["terminal_pv"])
        self.assertNotIn("payout_pv", valuation)

    def test_market_implied_growth_reprices_to_current_market_cap(self):
        implied_pct = implied_earnings_cagr(
            self.price, self.shares, self.income,
            self.required_return, self.terminal_pe, self.horizon,
        )
        self.assertIsNotNone(implied_pct)
        assert implied_pct is not None
        calc = calculate_pegr(
            self.price, self.shares, self.income, implied_pct,
            self.required_return, self.terminal_pe, self.horizon,
        )
        self.assertIsNotNone(calc)
        assert calc is not None
        self.assertAlmostEqual(calc["pegr"], 1.0, places=9)
        self.assertAlmostEqual(calc["fair_price"], self.price, places=7)
        self.assertAlmostEqual(calc["gap"], 0.0, places=9)

    def test_growth_changes_fair_value_monotonically(self):
        low = fair_market_cap(
            self.income, 5.0, self.required_return, self.terminal_pe, self.horizon,
        )
        high = fair_market_cap(
            self.income, 15.0, self.required_return, self.terminal_pe, self.horizon,
        )
        self.assertGreater(high["fair_market_cap"], low["fair_market_cap"])
        self.assertGreater(high["earnings_10"], low["earnings_10"])

    def test_invalid_inputs_are_rejected(self):
        self.assertIsNone(calculate_pegr(
            self.price, self.shares, -1, 5,
            self.required_return, self.terminal_pe, self.horizon,
        ))
        with self.assertRaises(ValueError):
            fair_market_cap(
                self.income, -100.0, self.required_return, self.terminal_pe, self.horizon,
            )


class LatestNetIncomeTest(unittest.TestCase):
    def setUp(self):
        cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31"])
        self.income = pd.DataFrame(
            [[120.0, 100.0, 80.0, -20.0]],
            index=["Net Income Common Stockholders"], columns=cols,
        )


    def test_statement_row_uses_priority(self):
        row, name = select_statement_row(
            self.income,
            ["Net Income Common Stockholders", "Net Income"],
        )
        self.assertEqual(name, "Net Income Common Stockholders")
        self.assertEqual(float(row.iloc[0]), 120.0)

    def test_latest_actual_income_is_used_instead_of_three_year_median(self):
        profile = extract_latest_net_income(self.income)
        self.assertEqual(profile["latest_net_income"], 120.0)
        self.assertEqual(profile["latest_net_income_date"], "2025-12-31")
        self.assertEqual(len(profile["net_income_series"]), 4)

    def test_latest_loss_is_not_replaced_with_an_older_profit(self):
        loss_first = self.income.copy()
        loss_first.iloc[0, 0] = -20.0
        profile = extract_latest_net_income(loss_first)
        self.assertEqual(profile["latest_net_income"], -20.0)
        self.assertEqual(profile["latest_net_income_date"], "2025-12-31")


class MarketCoverageTest(unittest.TestCase):
    KR_TICKERS = [
        "005930", "009150", "000660", "042700", "058470", "000100",
        "035420", "357780", "064760", "079940", "093320", "108320",
        "005290", "086450", "112610", "030190", "058610", "010120",
        "298040", "267260", "006260", "001440",
    ]

    def test_config_contains_all_pbgr_tickers_in_order(self):
        config = json.loads(Path("config.json").read_text(encoding="utf-8"))
        self.assertEqual(list(config["kr"]["assets"]), self.KR_TICKERS)
        self.assertEqual(config["kr"]["currency"], "KRW")
        self.assertEqual(len(config["us"]["assets"]), 3)

    def test_generated_payload_has_22_kr_and_3_us_assets(self):
        payload = json.loads(Path("pegr_data.json").read_text(encoding="utf-8"))
        kr = [asset for asset in payload["assets"] if asset["market"] == "KR"]
        us = [asset for asset in payload["assets"] if asset["market"] == "US"]
        self.assertEqual([asset["ticker"] for asset in kr], self.KR_TICKERS)
        self.assertEqual(len(us), 3)
        self.assertEqual(payload["warnings"], [])
        for asset in payload["assets"]:
            self.assertGreater(asset["price"], 0)
            self.assertGreater(asset["shares"], 0)
            self.assertGreater(asset["latest_net_income"], 0)
            self.assertRegex(asset["latest_net_income_date"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertNotIn("normalized_net_income", asset)
            self.assertNotIn("shareholder_payout_ratio_pct", asset)
            self.assertNotIn("payout_pv", asset)
            self.assertNotIn("payout_series", asset)
            self.assertAlmostEqual(asset["pegr"], 1.0, places=6)


class UiContractTest(unittest.TestCase):
    def test_pegr_labels_and_files(self):
        index = Path("index.html").read_text(encoding="utf-8")
        app = Path("app.js").read_text(encoding="utf-8")
        generator = Path("gen_pegr_data.py").read_text(encoding="utf-8")
        readme = Path("README.md").read_text(encoding="utf-8")
        combined = index + app + generator
        self.assertIn("PEGR", index)
        self.assertIn("시장 평가", index)
        self.assertIn("최신 실제 연간 지배주주순이익", index)
        self.assertIn("최신 실제 연간 지배주주순이익", readme)
        self.assertNotIn("주주환원율", combined + readme)
        self.assertNotIn("normalized_net_income", combined)
        self.assertNotIn("shareholder_payout_ratio", combined)
        self.assertNotIn("ticker.cash_flow", generator)
        self.assertNotIn("statistics.median", generator)
        self.assertTrue(Path("style.css").exists())
        self.assertTrue(Path("app.js").exists())

        self.assertIn('id="kr-body"', index)
        self.assertIn('id="us-body"', index)
        self.assertIn('id="req-kr"', index)
        self.assertIn('id="req-us"', index)
        self.assertIn('class="market-cagr-input"', app)
        self.assertIn('class="market-cagr-reset"', app)
        self.assertIn("fmtCompactMoney", app)
        self.assertIn("pegr_data.json?v=pegr-v03-20260805", app)
        self.assertIn("app.js?v=pegr-v03-20260805", index)
        self.assertIn("style.css?v=pegr-v03-20260805", index)
        self.assertNotIn("자본총계", index)
        self.assertNotIn("PBGR", index)
        self.assertLess(index.index("시가총액</th>"), index.index("시장 평가 ✎"))
        self.assertLess(index.index("시장 평가 ✎"), index.index("적정 시가총액</th>"))


if __name__ == "__main__":
    unittest.main()
