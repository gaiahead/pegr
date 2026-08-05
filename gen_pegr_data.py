#!/usr/bin/env python3
"""Generate PEGR data for Korean and US-listed companies.

PEGR is this project's latest-earnings growth valuation ratio. It is not the
conventional PEG ratio.
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable, Optional

import pandas as pd

CONFIG_PATH = Path("config.json")
OUTPUT_PATH = Path("pegr_data.json")
KST = timezone(timedelta(hours=9))
HTTP_TIMEOUT = 15
NAVER_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept-Language": "ko-KR"}

NET_INCOME_ROWS = (
    "Net Income Common Stockholders",
    "Net Income",
    "Net Income Including Noncontrolling Interests",
)


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _positive(value: Any) -> bool:
    return _finite(value) and float(value) > 0



def fair_market_cap(
    latest_net_income: float,
    earnings_cagr_pct: float,
    required_return: float,
    terminal_pe: float,
    horizon_years: int = 10,
) -> dict[str, float]:
    """Return the discounted year-end market cap from latest annual earnings."""
    values = (
        latest_net_income,
        earnings_cagr_pct,
        required_return,
        terminal_pe,
        horizon_years,
    )
    if not all(_finite(value) for value in values):
        raise ValueError("all valuation inputs must be finite")
    if latest_net_income <= 0:
        raise ValueError("latest net income must be positive")
    if earnings_cagr_pct <= -100:
        raise ValueError("earnings CAGR must be greater than -100%")
    if required_return <= -1:
        raise ValueError("required return must be greater than -100%")
    if terminal_pe <= 0:
        raise ValueError("terminal PE must be positive")
    if int(horizon_years) != horizon_years or horizon_years <= 0:
        raise ValueError("horizon years must be a positive integer")

    growth = earnings_cagr_pct / 100
    earnings_t = latest_net_income * (1 + growth) ** int(horizon_years)
    terminal_value = earnings_t * terminal_pe
    terminal_pv = terminal_value / (1 + required_return) ** int(horizon_years)
    if not all(_finite(v) and v >= 0 for v in (terminal_pv, earnings_t)):
        raise ValueError("valuation result is invalid")
    return {
        "fair_market_cap": terminal_pv,
        "terminal_pv": terminal_pv,
        "earnings_10": earnings_t,
    }


def calculate_pegr(
    price: float,
    shares: float,
    latest_net_income: float,
    earnings_cagr_pct: float,
    required_return: float,
    terminal_pe: float,
    horizon_years: int = 10,
) -> Optional[dict[str, float]]:
    """Calculate fair value, PEGR and gap for a current equity price."""
    if not (_positive(price) and _positive(shares) and _positive(latest_net_income)):
        return None
    try:
        valuation = fair_market_cap(
            latest_net_income,
            earnings_cagr_pct,
            required_return,
            terminal_pe,
            horizon_years,
        )
    except ValueError:
        return None

    market_cap = float(price) * float(shares)
    fair_cap = valuation["fair_market_cap"]
    if not _positive(fair_cap):
        return None
    pegr = market_cap / fair_cap
    return {
        **valuation,
        "market_cap": market_cap,
        "fair_price": fair_cap / float(shares),
        "pegr": pegr,
        "gap": 1 / pegr - 1,
    }


def implied_earnings_cagr(
    price: float,
    shares: float,
    latest_net_income: float,
    required_return: float,
    terminal_pe: float,
    horizon_years: int = 10,
) -> Optional[float]:
    """Solve the earnings CAGR that reprices to current market cap."""
    if not (_positive(price) and _positive(shares) and _positive(latest_net_income)):
        return None
    if not _finite(required_return) or required_return <= -1:
        return None
    if not _positive(terminal_pe):
        return None
    if int(horizon_years) != horizon_years or horizon_years <= 0:
        return None

    target = float(price) * float(shares)
    try:
        growth_factor = (
            target * (1 + float(required_return)) ** int(horizon_years)
            / (float(latest_net_income) * float(terminal_pe))
        ) ** (1 / int(horizon_years))
    except (OverflowError, ValueError, ZeroDivisionError):
        return None
    result = (growth_factor - 1) * 100
    return result if _finite(result) else None


def select_statement_row(
    statement: pd.DataFrame,
    candidates: Iterable[str],
) -> tuple[pd.Series, Optional[str]]:
    """Select the first available statement row by explicit priority."""
    if statement is None or statement.empty:
        return pd.Series(dtype="float64"), None
    for name in candidates:
        if name in statement.index:
            row = statement.loc[name]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            return pd.to_numeric(row, errors="coerce"), name
    return pd.Series(dtype="float64"), None


def _series_by_date(series: pd.Series) -> dict[str, float]:
    values: dict[str, float] = {}
    for column, value in series.items():
        if not _finite(value):
            continue
        try:
            key = pd.Timestamp(column).date().isoformat()
        except (TypeError, ValueError):
            key = str(column)
        values[key] = float(value)
    return values


def extract_latest_net_income(income_statement: pd.DataFrame) -> dict[str, Any]:
    """Return the latest reported annual net income without smoothing or skipping losses."""
    net_income_row, net_income_source = select_statement_row(
        income_statement, NET_INCOME_ROWS
    )
    income_by_date = _series_by_date(net_income_row)
    if not income_by_date:
        raise ValueError("annual net income unavailable")

    latest_date = sorted(income_by_date, reverse=True)[0]
    return {
        "latest_net_income": income_by_date[latest_date],
        "latest_net_income_date": latest_date,
        "net_income_series": {
            date: income_by_date[date]
            for date in sorted(income_by_date, reverse=True)
        },
        "source_row": net_income_source,
    }


def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def _http_get(
    url: str,
    headers: Optional[dict[str, str]] = None,
    timeout: int = HTTP_TIMEOUT,
    encoding: str = "utf-8",
) -> str:
    request = urllib.request.Request(
        url, headers=headers or {"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode(encoding, errors="ignore")


def get_naver_price(code: str) -> float:
    url = f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code}"
    data = json.loads(_http_get(url, timeout=10))
    return float(data["datas"][0]["closePrice"].replace(",", ""))


def _fetch_listed_shares(code: str) -> Optional[int]:
    url = f"https://finance.naver.com/item/coinfo.naver?code={code}"
    html = _http_get(url, headers=NAVER_HEADERS, encoding="euc-kr")
    start = html.find("상장주식수")
    if start < 0:
        return None
    match = re.search(r"<em[^>]*>([0-9,]+)</em>", html[start:start + 200])
    return int(match.group(1).replace(",", "")) if match else None


def get_naver_shares(code: str, preferred_code: Optional[str] = None) -> dict[str, Optional[int]]:
    common = _fetch_listed_shares(code)
    preferred = _fetch_listed_shares(preferred_code) if preferred_code else None
    total = (common or 0) + (preferred or 0)
    return {
        "total": total if total > 0 else None,
        "common": common,
        "preferred": preferred,
    }


def load_previous_assets() -> dict[str, dict[str, Any]]:
    if not OUTPUT_PATH.exists():
        return {}
    try:
        with OUTPUT_PATH.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        asset["ticker"]: asset
        for asset in payload.get("assets", [])
        if isinstance(asset, dict) and asset.get("ticker")
    }


def _fast_info_dict(ticker: Any) -> dict[str, Any]:
    try:
        return dict(ticker.fast_info)
    except Exception:
        return {}


def _resolve_market_data(ticker: Any) -> tuple[float, float, str]:
    fast = _fast_info_dict(ticker)
    info: Optional[dict[str, Any]] = None
    for key in ("regularMarketPreviousClose", "previousClose", "lastPrice"):
        if _positive(fast.get(key)):
            price = float(fast[key])
            price_source = f"fast_info.{key}"
            break
    else:
        info = ticker.info or {}
        for key in ("regularMarketPreviousClose", "previousClose", "regularMarketPrice"):
            if _positive(info.get(key)):
                price = float(info[key])
                price_source = f"info.{key}"
                break
        else:
            raise ValueError("price unavailable")

    shares = fast.get("shares")
    if not _positive(shares):
        info = info if info is not None else (ticker.info or {})
        shares = info.get("sharesOutstanding")
    if not _positive(shares):
        raise ValueError("shares unavailable")
    return price, float(shares), price_source


def fetch_asset(
    ticker_code: str,
    asset_config: dict[str, Any],
    market: str,
    currency: str,
    required_return: float,
    terminal_pe: float,
    horizon_years: int,
) -> dict[str, Any]:
    import yfinance as yf

    yahoo_symbol = asset_config.get("yahoo_symbol") or ticker_code
    ticker = yf.Ticker(yahoo_symbol)
    if market == "KR":
        price = get_naver_price(ticker_code)
        shares_data = get_naver_shares(
            ticker_code, asset_config.get("preferred_ticker")
        )
        shares = shares_data["total"]
        if not _positive(shares):
            raise ValueError("Naver listed shares unavailable")
        assert shares is not None
        shares = float(shares)
        price_source = "Naver Finance polling closePrice"
    else:
        price, shares, price_source = _resolve_market_data(ticker)
        shares_data = {"total": round(shares), "common": round(shares), "preferred": None}

    profile = extract_latest_net_income(ticker.income_stmt)
    latest_net_income = float(profile["latest_net_income"])
    market_cap = float(price) * float(shares)
    base_asset = {
        "ticker": ticker_code,
        "yahoo_symbol": yahoo_symbol,
        "name": asset_config.get("name") or ticker_code,
        "market": market,
        "currency": currency,
        "price": round(price, 6),
        "shares": round(shares),
        "shares_common": shares_data.get("common"),
        "shares_preferred": shares_data.get("preferred"),
        "market_cap": round(market_cap, 2),
        "latest_net_income": round(latest_net_income, 2),
        "latest_net_income_date": profile["latest_net_income_date"],
        "net_income_series": profile["net_income_series"],
        "source": {
            "provider": "Naver Finance + yfinance" if market == "KR" else "yfinance",
            "price": price_source,
            "financials": f"yfinance {yahoo_symbol}",
            "row": profile["source_row"],
        },
    }
    if latest_net_income <= 0:
        return {
            **base_asset,
            "market_implied_cagr_pct": None,
            "fair_market_cap": None,
            "fair_price": None,
            "pegr": None,
            "gap": None,
            "earnings_10": None,
            "terminal_pv": None,
            "valuation_note": "최신 실제 연간 순이익이 0 이하",
        }

    implied_pct = implied_earnings_cagr(
        price,
        shares,
        latest_net_income,
        required_return,
        terminal_pe,
        horizon_years,
    )
    if implied_pct is None:
        raise ValueError("market-implied earnings CAGR unavailable")
    calc = calculate_pegr(
        price,
        shares,
        latest_net_income,
        implied_pct,
        required_return,
        terminal_pe,
        horizon_years,
    )
    if calc is None:
        raise ValueError("PEGR calculation unavailable")

    return {
        **base_asset,
        "market_implied_cagr_pct": round(implied_pct, 6),
        "fair_market_cap": round(calc["fair_market_cap"], 2),
        "fair_price": round(calc["fair_price"], 6),
        "pegr": round(calc["pegr"], 12),
        "gap": round(calc["gap"], 12),
        "earnings_10": round(calc["earnings_10"], 2),
        "terminal_pv": round(calc["terminal_pv"], 2),
    }


def build_payload(config: dict[str, Any]) -> dict[str, Any]:
    previous = load_previous_assets()
    assets: list[dict[str, Any]] = []
    warnings: list[str] = []
    market_settings: dict[str, dict[str, Any]] = {}
    expected: list[str] = []

    for market_key, market_config in config.items():
        market = str(market_config.get("market") or market_key).upper()
        currency = str(market_config.get("currency") or ("KRW" if market == "KR" else "USD"))
        required_return = float(market_config["required_return"])
        terminal_pe = float(market_config["terminal_pe"])
        horizon_years = int(market_config.get("horizon_years", 10))
        market_settings[market] = {
            "currency": currency,
            "required_return": required_return,
            "terminal_pe": terminal_pe,
            "horizon_years": horizon_years,
        }

        for ticker_code, asset_config in market_config["assets"].items():
            expected.append(ticker_code)
            last_error: Optional[Exception] = None
            for attempt in range(1, 4):
                try:
                    asset = fetch_asset(
                        ticker_code,
                        asset_config,
                        market,
                        currency,
                        required_return,
                        terminal_pe,
                        horizon_years,
                    )
                    assets.append(asset)
                    implied = asset.get("market_implied_cagr_pct")
                    if _finite(implied):
                        assert implied is not None
                        print(
                            f"[OK] {ticker_code}: implied CAGR "
                            f"{float(implied):.2f}%"
                        )
                    else:
                        print(f"[OK] {ticker_code}: valuation unavailable")
                    break
                except Exception as exc:  # network/data provider boundary
                    last_error = exc
                    if attempt < 3:
                        time.sleep(attempt)
            else:
                warning = f"{ticker_code}: {last_error}"
                warnings.append(warning)
                if ticker_code in previous and "latest_net_income" in previous[ticker_code]:
                    fallback = dict(previous[ticker_code])
                    fallback["data_note"] = f"이전 검증 데이터 유지 · {warning}"
                    assets.append(fallback)
                    print(f"[WARN] {warning}; previous data preserved")
                else:
                    print(f"[ERROR] {warning}")

    actual = [asset["ticker"] for asset in assets]
    missing = [symbol for symbol in expected if symbol not in actual]
    if missing:
        raise RuntimeError(f"missing configured assets: {', '.join(missing)}")

    return {
        "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "market_settings": market_settings,
        "assets": assets,
        "warnings": warnings,
    }


def main() -> None:
    payload = build_payload(load_config())
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    OUTPUT_PATH.write_text(text, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH} ({len(payload['assets'])} assets)")


if __name__ == "__main__":
    main()
