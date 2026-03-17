"""Benchmark service — resolve index definitions, fetch market caps, compute weights."""

from __future__ import annotations

import numpy as np
from typing import Optional

try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False

from ..data.presets import PRESETS


# Well-known index symbols
INDEX_SYMBOLS = {
    "nikkei225": "^N225",
    "topix": "0010.T",  # TOPIX ETF as proxy (real ^TPX has limited data)
    "sp500": "^GSPC",
    "nasdaq100": "^NDX",
}

# Weighting schemes
WEIGHTING_SCHEMES = {
    "nikkei225": "price_weighted",
    "topix": "market_cap_weighted",
    "sp500": "market_cap_weighted",
    "nasdaq100": "market_cap_weighted",
}


def resolve_benchmark(
    index_id: Optional[str] = None,
    preset_id: Optional[str] = None,
    target_holdings: int = 0,
    period: str = "1y",
) -> dict:
    """Resolve a benchmark definition into tickers, weights, and optional index series.

    Returns:
        {
            "tickers": [...],
            "names": {...},
            "weights": [...],
            "weighting_scheme": "price_weighted" | "market_cap_weighted" | "manual",
            "weights_source": "estimated" | "preset",
            "index_symbol": "^N225" | null,
            "index_series": [...] | null,  # Daily index values
        }
    """
    if not HAS_YFINANCE:
        raise RuntimeError("yfinance not available")

    # Start from preset if given
    if preset_id and preset_id in PRESETS:
        preset = PRESETS[preset_id]
        universe = preset["universe"]
        tickers = list(universe.keys())
        names = {t: v["name"] for t, v in universe.items()}
        weights = np.array([v["bench_w"] for v in universe.values()])

        result = {
            "tickers": tickers,
            "names": names,
            "weights": weights.tolist(),
            "weighting_scheme": "manual",
            "weights_source": "preset",
            "index_symbol": None,
            "index_series": None,
        }

        # Try to match preset to a known index for chart overlay
        if "topix" in preset_id.lower():
            result["index_symbol"] = INDEX_SYMBOLS.get("topix")
        elif "nikkei" in preset_id.lower():
            result["index_symbol"] = INDEX_SYMBOLS.get("nikkei225")
        elif "sp500" in preset_id.lower() or "s&p" in preset_id.lower():
            result["index_symbol"] = INDEX_SYMBOLS.get("sp500")

        # Fetch real index series if available
        if result["index_symbol"]:
            try:
                idx_data = yf.download(result["index_symbol"], period=period, progress=False)
                if not idx_data.empty:
                    closes = idx_data["Close"]
                    if hasattr(closes, 'iloc'):
                        result["index_series"] = [
                            {"date": str(d.date()), "value": float(v)}
                            for d, v in zip(closes.index, closes.values.flat)
                            if not np.isnan(v)
                        ]
            except Exception:
                pass

        return result

    # Resolve from known index
    if not index_id or index_id not in INDEX_SYMBOLS:
        raise ValueError(f"Unknown index: {index_id}. Available: {list(INDEX_SYMBOLS.keys())}")

    scheme = WEIGHTING_SCHEMES.get(index_id, "market_cap_weighted")
    index_symbol = INDEX_SYMBOLS[index_id]

    # For known indexes, we need constituent lists
    # These are hardcoded for MVP — in production, use official sources
    from ..data.constituents import get_constituents
    tickers, names = get_constituents(index_id)

    if target_holdings > 0 and target_holdings < len(tickers):
        tickers = tickers[:target_holdings]
        names = {t: names[t] for t in tickers}

    # Compute weights
    if scheme == "price_weighted":
        weights = _compute_price_weights(tickers)
    elif scheme == "market_cap_weighted":
        weights = _compute_market_cap_weights(tickers)
    else:
        weights = np.ones(len(tickers)) / len(tickers)

    # Fetch index series
    index_series = None
    try:
        idx_data = yf.download(index_symbol, period=period, progress=False)
        if not idx_data.empty:
            closes = idx_data["Close"]
            index_series = [
                {"date": str(d.date()), "value": float(v)}
                for d, v in zip(closes.index, closes.values.flat)
                if not np.isnan(v)
            ]
    except Exception:
        pass

    return {
        "tickers": tickers,
        "names": names,
        "weights": weights.tolist(),
        "weighting_scheme": scheme,
        "weights_source": "estimated",
        "index_symbol": index_symbol,
        "index_series": index_series,
    }


def _compute_price_weights(tickers: list[str]) -> np.ndarray:
    """Price-weighted (Nikkei 225 style)."""
    try:
        data = yf.download(tickers, period="1d", progress=False)
        prices = data["Close"].iloc[-1].values.astype(float)
        total = np.nansum(prices)
        if total > 0:
            weights = np.nan_to_num(prices / total)
            return weights
    except Exception:
        pass
    return np.ones(len(tickers)) / len(tickers)


def _compute_market_cap_weights(tickers: list[str]) -> np.ndarray:
    """Market-cap weighted (TOPIX / S&P 500 style)."""
    caps = []
    for t in tickers:
        try:
            info = yf.Ticker(t).info
            mc = info.get("marketCap", 0)
            caps.append(float(mc) if mc else 0.0)
        except Exception:
            caps.append(0.0)

    caps_arr = np.array(caps)
    total = np.sum(caps_arr)
    if total > 0:
        return caps_arr / total
    return np.ones(len(tickers)) / len(tickers)
