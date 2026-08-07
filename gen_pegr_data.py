#!/usr/bin/env python3
"""Generate conventional PEG/PEGR data for Korean and US-listed companies.

PEGR follows the standard PEG convention:

    PEGR = current P/E / expected EPS CAGR expressed as a percent number
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


def calculate_per(
    price: float,
    shares: float,
    latest_net_income: float,
) -> Optional[dict[str, float]]:
    """Calculate current market cap, latest EPS, and current P/E."""
    if not (_positive(price) and _positive(shares) and _positive(latest_net_income)):
        return None
    market_cap = float(price) * float(shares)
    latest_eps = float(latest_net_income) / float(shares)
    if not _positive(latest_eps):
        return None
    current_per = float(price) / latest_eps
    if not _positive(current_per):
        return None
    return {
        "market_cap": market_cap,
        "latest_eps": latest_eps,
        "current_per": current_per,
    }


def calculate_pegr(
    price: float,
    shares: float,
    latest_net_income: float,
    eps_cagr_pct: float,
) -> Optional[dict[str, float]]:
    """Calculate conventional PEGR = current P/E / expected EPS CAGR(%)."""
    per = calculate_per(price, shares, latest_net_income)
    if per is None or not _positive(eps_cagr_pct):
        return None
    pegr = per["current_per"] / float(eps_cagr_pct)
    if not _positive(pegr):
        return None
    return {
        **per,
        "eps_cagr_pct": float(eps_cagr_pct),
        "pegr": pegr,
    }


def implied_eps_cagr(
    price: float,
    shares: float,
    latest_net_income: float,
) -> Optional[float]:
    """Return the EPS CAGR percentage that makes conventional PEGR equal 1.0."""
    per = calculate_per(price, shares, latest_net_income)
    return per["current_per"] if per is not None else None


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
    """Return the latest actual annual net income without smoothing or skipping losses."""
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


def get_naver_shares(
    code: str,
    preferred_code: Optional[str] = None,
) -> dict[str, Optional[int]]:
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
        shares_data = {
            "total": round(shares),
            "common": round(shares),
            "preferred": None,
        }

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

    per = calculate_per(price, shares, latest_net_income)
    if per is None:
        return {
            **base_asset,
            "latest_eps": None,
            "current_per": None,
            "market_implied_eps_cagr_pct": None,
            "pegr": None,
            "valuation_note": "최신 실제 연간 순이익이 0 이하",
        }

    implied_pct = implied_eps_cagr(price, shares, latest_net_income)
    assert implied_pct is not None
    calc = calculate_pegr(price, shares, latest_net_income, implied_pct)
    if calc is None:
        raise ValueError("PEGR calculation unavailable")

    return {
        **base_asset,
        "latest_eps": round(calc["latest_eps"], 12),
        "current_per": round(calc["current_per"], 12),
        "market_implied_eps_cagr_pct": round(implied_pct, 12),
        "pegr": round(calc["pegr"], 12),
    }


def build_payload(config: dict[str, Any]) -> dict[str, Any]:
    previous = load_previous_assets()
    assets: list[dict[str, Any]] = []
    warnings: list[str] = []
    market_settings: dict[str, dict[str, str]] = {}
    expected: list[str] = []

    for market_key, market_config in config.items():
        market = str(market_config.get("market") or market_key).upper()
        currency = str(
            market_config.get("currency") or ("KRW" if market == "KR" else "USD")
        )
        market_settings[market] = {"currency": currency}

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
                    )
                    assets.append(asset)
                    pegr = asset.get("pegr")
                    current_per = asset.get("current_per")
                    if _finite(pegr) and _finite(current_per):
                        assert pegr is not None and current_per is not None
                        print(
                            f"[OK] {ticker_code}: PER {float(current_per):.2f}, "
                            f"PEGR {float(pegr):.3f}"
                        )
                    else:
                        print(f"[OK] {ticker_code}: PEGR unavailable")
                    break
                except Exception as exc:  # network/data provider boundary
                    last_error = exc
                    if attempt < 3:
                        time.sleep(attempt)
            else:
                warning = f"{ticker_code}: {last_error}"
                warnings.append(warning)
                previous_asset = previous.get(ticker_code)
                if previous_asset and "latest_net_income" in previous_asset:
                    fallback = dict(previous_asset)
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
