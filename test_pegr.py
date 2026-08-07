import json
import unittest
from pathlib import Path

import pandas as pd

from gen_pegr_data import (
    calculate_pegr,
    calculate_per,
    extract_latest_net_income,
    implied_eps_cagr,
    select_statement_row,
)


class PegrCalculationTest(unittest.TestCase):
    def test_original_peg_examples(self):
        cases = [
            (15.0, 15.0, 1.0),
            (20.0, 10.0, 2.0),
            (10.0, 20.0, 0.5),
        ]
        for per, growth, expected in cases:
            with self.subTest(per=per, growth=growth):
                calc = calculate_pegr(
                    price=per,
                    shares=100.0,
                    latest_net_income=100.0,
                    eps_cagr_pct=growth,
                )
                self.assertIsNotNone(calc)
                assert calc is not None
                self.assertAlmostEqual(calc["current_per"], per)
                self.assertAlmostEqual(calc["pegr"], expected)

    def test_per_uses_current_price_shares_and_latest_income(self):
        calc = calculate_per(price=25.0, shares=200.0, latest_net_income=250.0)
        self.assertIsNotNone(calc)
        assert calc is not None
        self.assertEqual(calc["market_cap"], 5_000.0)
        self.assertEqual(calc["latest_eps"], 1.25)
        self.assertEqual(calc["current_per"], 20.0)

    def test_implied_growth_equals_current_per_and_reprices_pegr_to_one(self):
        implied = implied_eps_cagr(25.0, 200.0, 250.0)
        self.assertEqual(implied, 20.0)
        calc = calculate_pegr(25.0, 200.0, 250.0, implied)
        self.assertIsNotNone(calc)
        assert calc is not None
        self.assertAlmostEqual(calc["pegr"], 1.0)

    def test_nonpositive_income_or_growth_is_not_valuatable(self):
        self.assertIsNone(calculate_per(10, 100, 0))
        self.assertIsNone(calculate_pegr(10, 100, 100, 0))
        self.assertIsNone(calculate_pegr(10, 100, 100, -5))
        self.assertIsNone(implied_eps_cagr(10, 100, -1))


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
        "298040", "267260", "006260", "001440", "475150",
    ]
    RETIRED_FIELDS = {
        "fair_market_cap", "fair_price", "gap", "valuation_multiple",
        "current_net_income", "earnings_10", "terminal_pv", "elapsed_years",
        "market_implied_cagr_pct",
    }

    def test_config_contains_all_pbgr_tickers_in_order(self):
        config = json.loads(Path("config.json").read_text(encoding="utf-8"))
        self.assertEqual(list(config["kr"]["assets"]), self.KR_TICKERS)
        self.assertEqual(config["kr"]["currency"], "KRW")
        self.assertEqual(len(config["us"]["assets"]), 3)
        for market in ("kr", "us"):
            self.assertNotIn("required_return", config[market])
            self.assertNotIn("terminal_pe", config[market])
            self.assertNotIn("horizon_years", config[market])

    def test_generated_payload_has_23_kr_and_3_us_assets(self):
        payload = json.loads(Path("pegr_data.json").read_text(encoding="utf-8"))
        kr = [asset for asset in payload["assets"] if asset["market"] == "KR"]
        us = [asset for asset in payload["assets"] if asset["market"] == "US"]
        self.assertEqual([asset["ticker"] for asset in kr], self.KR_TICKERS)
        self.assertEqual(len(us), 3)
        self.assertEqual(payload["warnings"], [])
        for settings in payload["market_settings"].values():
            self.assertEqual(set(settings), {"currency"})
        for asset in payload["assets"]:
            self.assertGreater(asset["price"], 0)
            self.assertGreater(asset["shares"], 0)
            self.assertGreater(asset["latest_net_income"], 0)
            self.assertGreater(asset["latest_eps"], 0)
            self.assertGreater(asset["current_per"], 0)
            self.assertAlmostEqual(
                asset["market_implied_eps_cagr_pct"],
                asset["current_per"],
                places=9,
            )
            self.assertAlmostEqual(asset["pegr"], 1.0, places=9)
            self.assertTrue(self.RETIRED_FIELDS.isdisjoint(asset))


class UiContractTest(unittest.TestCase):
    def test_original_pegr_labels_and_files(self):
        index = Path("index.html").read_text(encoding="utf-8")
        app = Path("app.js").read_text(encoding="utf-8")
        generator = Path("gen_pegr_data.py").read_text(encoding="utf-8")
        readme = Path("README.md").read_text(encoding="utf-8")
        combined = index + app + generator
        documentation = combined + readme

        self.assertIn("PEGR = PER ÷ 예상 EPS CAGR", index)
        self.assertIn("예상 EPS CAGR ✎", index)
        self.assertIn("현재 PER", index)
        self.assertIn("최신 실제 연간 지배주주순이익", readme)
        self.assertIn("PER 15 / 예상 EPS CAGR 15% = PEGR 1.000", readme)
        for retired in (
            "요구수익률", "10년 후 PER", "적정 시가총액", "적정가", "괴리율",
            "성장 조정 10년 후 PER", "Growth-adjusted Year-10 P/E",
        ):
            self.assertNotIn(retired, combined)
        self.assertNotIn("fairMarketCap", app)
        self.assertNotIn("impliedEarningsCagr", app)
        self.assertNotIn("market_implied_cagr_pct", generator)
        self.assertNotIn("required_return", generator)
        self.assertNotIn("terminal_pe", generator)
        self.assertNotIn("horizon_years", generator)

        self.assertIn('id="kr-body"', index)
        self.assertIn('id="us-body"', index)
        self.assertIn('class="eps-cagr-input"', app)
        self.assertIn('class="eps-cagr-reset"', app)
        self.assertIn("pegr_data.json?v=pegr-v05-20260807", app)
        self.assertIn("app.js?v=pegr-v05-20260807", index)
        self.assertIn("style.css?v=pegr-v05-20260807", index)
        self.assertLess(index.index("현재 PER</th>"), index.index("예상 EPS CAGR ✎"))
        self.assertLess(index.index("예상 EPS CAGR ✎"), index.index("PEGR</th>"))


if __name__ == "__main__":
    unittest.main()
