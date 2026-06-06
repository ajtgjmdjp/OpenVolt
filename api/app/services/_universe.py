"""Shared helpers for resolving a preset universe and fetching price data.

`backtest_service`, `openvolt_service`, and any future entry point all
need the same three-step setup:

1. Resolve the preset's universe into (tickers, benchmark weights), pulling
   from the dynamic benchmark resolver when the preset declares it.
2. Download adjusted close prices from yfinance for that universe.
3. Drop tickers with too little history, forward-fill gaps, and
   renormalize the benchmark weights over what survives.

Keeping this in one module means the three callers stay in sync on what
"enough data" means and on how the renormalization round-trips through
the universe dict.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

MIN_PRICE_OBS_PER_TICKER = 30


def resolve_universe(
    preset: dict[str, Any], period: str
) -> tuple[list[str], np.ndarray, dict[str, dict[str, Any]]]:
    """Return ``(tickers, bench_w, universe_dict)`` for the preset.

    `universe_dict` is the preset's literal universe map for static presets,
    or a synthesized ``{ticker: {name, bench_w}}`` map for dynamic presets.
    """
    universe = preset["universe"]
    if universe == "dynamic":
        from .benchmark_service import resolve_benchmark

        index_id = preset.get("index_id")
        target = preset.get("target_holdings", 0)
        resolved = resolve_benchmark(index_id=index_id, target_holdings=target, period=period)
        tickers = list(resolved["tickers"])
        bench_w = np.asarray(resolved["weights"], dtype=float)
        names_lookup = resolved.get("names", {})
        universe_dict = {
            t: {"name": names_lookup.get(t, t), "bench_w": float(bench_w[i])}
            for i, t in enumerate(tickers)
        }
        return tickers, bench_w, universe_dict

    tickers = list(universe.keys())
    bench_w = np.asarray([universe[t]["bench_w"] for t in tickers], dtype=float)
    return tickers, bench_w, dict(universe)


def fetch_prices(
    tickers: list[str], period: str, *, downloader=None
) -> pd.DataFrame:
    """Download adjusted close prices from yfinance for ``tickers``.

    ``downloader`` is injectable so tests don't have to mock module state.
    """
    if downloader is None:
        import yfinance as yf

        downloader = yf.download
    data = downloader(tickers, period=period, auto_adjust=True, progress=False)
    if isinstance(data.columns, pd.MultiIndex):
        return data["Close"]
    if len(tickers) == 1:
        return data[["Close"]].rename(columns={"Close": tickers[0]})
    return data["Close"]


def filter_and_renormalize(
    close: pd.DataFrame,
    tickers: list[str],
    bench_w: np.ndarray,
    universe_dict: dict[str, dict[str, Any]] | None = None,
    *,
    min_obs: int = MIN_PRICE_OBS_PER_TICKER,
) -> tuple[pd.DataFrame, list[str], np.ndarray, dict[str, dict[str, Any]] | None]:
    """Drop tickers without enough history and renormalize ``bench_w``.

    Returns ``(close_clean, kept_tickers, kept_bench_w, kept_universe_dict)``.
    The returned DataFrame is forward-filled and stripped of leading NaNs.
    """
    available = [
        t for t in tickers if t in close.columns and close[t].notna().sum() > min_obs
    ]
    if not available:
        return close.iloc[0:0], [], np.empty(0), {} if universe_dict is not None else None

    close_clean = close[available].ffill().dropna()
    if len(available) == len(tickers):
        return close_clean, available, bench_w, universe_dict

    dropped = [t for t in tickers if t not in available]
    logger.info("Dropped %d ticker(s) with insufficient history: %s", len(dropped), dropped)

    idx_map = {t: i for i, t in enumerate(tickers)}
    raw_w = np.asarray([bench_w[idx_map[t]] for t in available], dtype=float)
    weight_sum = float(raw_w.sum())
    if weight_sum <= 0.0:
        # Fallback to equal weights so downstream code never divides by zero.
        kept_w = np.full(len(available), 1.0 / len(available))
    else:
        kept_w = raw_w / weight_sum

    kept_universe = None
    if universe_dict is not None:
        kept_universe = {
            t: universe_dict.get(t, {"name": t, "bench_w": float(kept_w[i])})
            for i, t in enumerate(available)
        }

    return close_clean, available, kept_w, kept_universe
