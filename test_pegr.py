import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from gen_pegr_data import (
    calculate_pegr,
    extract_financial_profile,
    fair_market_cap,
    implied_earnings_cagr,
    normalize_payout_ratio,
    select_statement_row,
)


class PegrCalculationTest(unittest.TestCase):
    def setUp(self):
        self.price = 100.0
        self.shares = 1_000_000_000
        self.income = 10_000_000_000
        self.payout = 0.50
        self.required_return = 0.10
        self.terminal_pe = 15.0
        self.horizon = 10

    def test_payout_is_added_to_terminal_value(self):
        no_payout = fair_market_cap(
            self.income, 8.0, 0.0, self.required_return,
            self.terminal_pe, self.horizon,
        )
        with_payout = fair_market_cap(
            self.income, 8.0, self.payout, self.required_return,
            self.terminal_pe, self.horizon,
        )
        self.assertGreater(with_payout["fair_market_cap"], no_payout["fair_market_cap"])
        self.assertGreater(with_payout["payout_pv"], 0)

    def test_market_implied_growth_reprices_to_current_market_cap(self):
        implied_pct = implied_earnings_cagr(
            self.price, self.shares, self.income, self.payout,
            self.required_return, self.terminal_pe, self.horizon,
        )
        self.assertIsNotNone(implied_pct)
        calc = calculate_pegr(
            self.price, self.shares, self.income, self.payout,
            implied_pct, self.required_return, self.terminal_pe, self.horizon,
        )
        self.assertIsNotNone(calc)
        assert calc is not None
        self.assertAlmostEqual(calc["pegr"], 1.0, places=9)
        self.assertAlmostEqual(calc["fair_price"], self.price, places=7)
        self.assertAlmostEqual(calc["gap"], 0.0, places=9)

    def test_growth_changes_fair_value_monotonically(self):
        low = fair_market_cap(
            self.income, 5.0, self.payout, self.required_return,
            self.terminal_pe, self.horizon,
        )
        high = fair_market_cap(
            self.income, 15.0, self.payout, self.required_return,
            self.terminal_pe, self.horizon,
        )
        self.assertGreater(high["fair_market_cap"], low["fair_market_cap"])
        self.assertGreater(high["earnings_10"], low["earnings_10"])

    def test_invalid_inputs_are_rejected(self):
        self.assertIsNone(calculate_pegr(
            self.price, self.shares, -1, self.payout, 5,
            self.required_return, self.terminal_pe, self.horizon,
        ))
        with self.assertRaises(ValueError):
            fair_market_cap(
                self.income, -100.0, self.payout, self.required_return,
                self.terminal_pe, self.horizon,
            )


class FinancialNormalizationTest(unittest.TestCase):
    def setUp(self):
        cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31"])
        self.income = pd.DataFrame(
            [[120.0, 100.0, 80.0, -20.0]],
            index=["Net Income Common Stockholders"], columns=cols,
        )
        self.cashflow = pd.DataFrame(
            [
                [-12.0, -10.0, -8.0, -6.0],
                [-60.0, -45.0, -30.0, -10.0],
                [2.0, 2.0, 2.0, 2.0],
            ],
            index=[
                "Cash Dividends Paid",
                "Repurchase Of Capital Stock",
                "Issuance Of Capital Stock",
            ],
            columns=cols,
        )

    def test_statement_row_uses_priority(self):
        row, name = select_statement_row(
            self.income,
            ["Net Income Common Stockholders", "Net Income"],
        )
        self.assertEqual(name, "Net Income Common Stockholders")
        self.assertEqual(float(row.iloc[0]), 120.0)

    def test_three_year_income_median_and_aligned_payout(self):
        profile = extract_financial_profile(self.income, self.cashflow)
        self.assertEqual(profile["normalized_net_income"], 100.0)
        self.assertEqual(len(profile["net_income_series"]), 3)
        expected_ratios = [(12 + 60 - 2) / 120, (10 + 45 - 2) / 100, (8 + 30 - 2) / 80]
        self.assertAlmostEqual(
            profile["shareholder_payout_ratio"],
            sorted(expected_ratios)[1],
        )

    def test_payout_ratio_is_clamped(self):
        self.assertEqual(normalize_payout_ratio(-2.0), 0.0)
        self.assertEqual(normalize_payout_ratio(2.0), 1.0)
        self.assertEqual(normalize_payout_ratio(0.4), 0.4)


class UiContractTest(unittest.TestCase):
    def test_pegr_labels_and_files(self):
        html = Path("index.html").read_text(encoding="utf-8")
        app = Path("app.js").read_text(encoding="utf-8")
        self.assertIn("PEGR 가치평가 모니터", html)
        self.assertIn("시장 평가 ✎", html)
        self.assertIn("종료 PER", html)
        self.assertIn("주주환원율", html)
        self.assertIn('class="market-cagr-input"', app)
        self.assertIn('class="market-cagr-reset"', app)
        self.assertNotIn("자본총계", html)
        self.assertNotIn("PBGR", html)
        self.assertLess(html.index("시가총액</th>"), html.index("시장 평가 ✎"))
        self.assertLess(html.index("시장 평가 ✎"), html.index("적정 시가총액</th>"))


if __name__ == "__main__":
    unittest.main()
