"""Bridge between FastAPI and the C++ OpenVolt core via pybind11."""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

import numpy as np

from ._universe import fetch_prices, filter_and_renormalize, resolve_universe

logger = logging.getLogger(__name__)

TRADING_DAYS_PER_YEAR = 252

# Add build directory to path so we can import the C++ module
_build_dir = str(Path(__file__).resolve().parents[3] / "build")
if _build_dir not in sys.path:
    sys.path.insert(0, _build_dir)

try:
    import _openvolt as ov
    HAS_ENGINE = True
except ImportError:
    HAS_ENGINE = False

# Lazy import yfinance
try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False


def prefetch_market_data(preset: dict, period: str = "1y") -> dict:
    """Fetch and cache market data for reuse across multiple optimization runs."""
    tickers, bench_w, universe_dict = resolve_universe(preset, period)
    raw_close = fetch_prices(tickers, period)
    close, tickers, bench_w, universe_dict = filter_and_renormalize(
        raw_close, tickers, bench_w, universe_dict
    )

    half_idx = len(close) // 2

    return {
        "tickers": tickers,
        "latest_prices": close.iloc[-1].values.astype(float),
        "as_of": str(close.index[-1].date()),
        "cov_annual": close.pct_change().dropna().cov().values * TRADING_DAYS_PER_YEAR,
        "prices_then": close.iloc[half_idx].values.astype(float),
        "half_year_ago": close.index[half_idx],
        "bench_w": bench_w,
        "universe": universe_dict,
    }


def run_optimization(preset: dict, risk_model_name: str = "sample",
                     disposal_method: str = "specific_id",
                     period: str = "1y",
                     cached_market_data: dict | None = None) -> dict:
    """Run a full optimization pipeline and return structured results."""

    if not HAS_ENGINE:
        raise RuntimeError("OpenVolt C++ engine not available. Build with: cmake --build build")

    tickers, bench_w_resolved, universe = resolve_universe(preset, period)
    N = len(tickers)

    # --- Stage 1: Fetch prices (or use cached data) ---
    t0 = time.perf_counter()
    if cached_market_data is not None:
        # Reuse pre-fetched data (sweep/MC optimization)
        tickers = cached_market_data["tickers"]
        N = len(tickers)
        latest_prices = cached_market_data["latest_prices"]
        as_of = cached_market_data["as_of"]
        cov_annual = cached_market_data["cov_annual"]
        prices_then = cached_market_data["prices_then"]
        half_year_ago = cached_market_data["half_year_ago"]
        bench_w_resolved = cached_market_data.get("bench_w", bench_w_resolved)
        universe = cached_market_data.get("universe", universe)
    elif HAS_YFINANCE:
        raw_close = fetch_prices(tickers, period)
        close, tickers, bench_w_resolved, universe = filter_and_renormalize(
            raw_close, tickers, bench_w_resolved, universe
        )
        N = len(tickers)

        latest_prices = close.iloc[-1].values.astype(float)
        as_of = str(close.index[-1].date())

        # Covariance from daily returns
        daily_returns = close.pct_change().dropna()
        cov_annual = daily_returns.cov().values * TRADING_DAYS_PER_YEAR

        # Build portfolio (simulated: bought 6 months ago at benchmark weights)
        half_idx = len(close) // 2
        half_year_ago = close.index[half_idx]
        prices_then = close.loc[half_year_ago].values.astype(float)
    else:
        # Fallback: fake data
        latest_prices = np.array([float(3000 + i * 500) for i in range(N)])
        as_of = "2026-03-17"
        cov_annual = np.eye(N) * 0.04
        prices_then = latest_prices * 0.95
        half_year_ago_str = "2025-09-17"

    fetch_ms = int((time.perf_counter() - t0) * 1000)

    # Precompute ticker → index map
    ticker_idx = {t: i for i, t in enumerate(tickers)}

    # --- Stage 2: Build portfolio ---
    initial_investment = preset.get("initial_investment", 100_000_000)
    if bench_w_resolved is not None:
        bench_w_static = bench_w_resolved
    else:
        bench_w_static = np.array([universe[t]["bench_w"] for t in tickers], dtype=float)

    lots = []
    cash_used = 0.0
    for i, t in enumerate(tickers):
        target = initial_investment * bench_w_static[i]
        shares = int(target / prices_then[i])
        if shares > 0:
            acq_date = str(half_year_ago.date()) if HAS_YFINANCE else "2025-09-17"
            lots.append(ov.TaxLot(i + 1, t, float(shares), float(prices_then[i]), acq_date))
            cash_used += shares * prices_then[i]

    remaining_cash = initial_investment - cash_used

    # Drift weights
    bench_shares = {t: initial_investment * bench_w_static[i] / prices_then[i]
                    for i, t in enumerate(tickers)}
    bench_current = np.array([bench_shares[t] * latest_prices[i] for i, t in enumerate(tickers)])
    drifted_w = bench_current / bench_current.sum()

    # Total value
    total_value = remaining_cash
    for lot in lots:
        idx = ticker_idx[lot.asset_id]
        total_value += lot.shares * latest_prices[idx]

    # Current weights
    current_w = {}
    for lot in lots:
        idx = ticker_idx[lot.asset_id]
        current_w[lot.asset_id] = lot.shares * latest_prices[idx] / total_value

    # --- Stage 3: Risk model ---
    t1 = time.perf_counter()
    risk = ov.FullCovarianceRisk(asset_ids=tickers, covariance=cov_annual)
    risk_ms = int((time.perf_counter() - t1) * 1000)

    # --- Stage 4: Optimize ---
    portfolio = ov.PortfolioState(as_of=as_of, cash=remaining_cash, lots=lots)
    market = ov.MarketData(
        as_of=as_of, asset_ids=tickers, prices=latest_prices,
        benchmark_weights=drifted_w,
        transaction_cost_bps=np.full(N, 5.0),
        risk_model=risk,
    )

    config = ov.OptimizationConfig()
    constraints = preset.get("constraints", {})
    config.constraints.max_turnover = constraints.get("max_turnover", 0.15)
    config.constraints.cash_buffer = constraints.get("cash_buffer", 1_000_000)
    max_w = constraints.get("max_weight", 0.20)
    for t in tickers:
        config.constraints.weight_bounds[t] = ov.WeightBound(0.0, max_w)

    config.taxes.short_term_rate = preset.get("tax_rate", 0.20315)
    config.taxes.long_term_rate = preset.get("tax_rate", 0.20315)
    config.taxes.wash_sale_window_days = None

    obj = preset.get("objective", {})
    config.objective.tracking_error = obj.get("tracking_error", 200.0)
    config.objective.transaction_cost = obj.get("transaction_cost", 0.0)
    config.objective.tax_cost = obj.get("tax_cost", 400.0)
    config.min_trade_notional = 100_000
    config.round_to_whole_shares = True

    disposal_map = {
        "specific_id": ov.DisposalMethod.specific_id,
        "fifo": ov.DisposalMethod.fifo,
        "lifo": ov.DisposalMethod.lifo,
    }
    config.taxes.disposal_method = disposal_map.get(disposal_method, ov.DisposalMethod.specific_id)

    t2 = time.perf_counter()
    result = ov.plan_rebalance(ov.RebalanceRequest(portfolio, market, config))
    solve_ms = int((time.perf_counter() - t2) * 1000)

    # --- Format results ---
    trades = []
    for t in result.trades:
        trades.append({
            "asset_id": t.asset_id,
            "name": universe.get(t.asset_id, {}).get("name", t.asset_id),
            "side": "buy" if t.side == ov.Side.buy else "sell",
            "shares": round(t.shares),
            "notional": round(t.notional),
        })

    lot_dispositions = []
    for d in result.lot_dispositions:
        lot_dispositions.append({
            "lot_id": d.lot_id,
            "asset_id": d.asset_id,
            "shares_sold": round(d.shares_sold),
            "realized_gain": round(d.realized_gain),
            "tax_liability": round(d.tax_liability),
        })

    target_weights = {
        tickers[i]: round(result.target_weights[i], 6)
        for i in range(N)
    }

    return {
        "timing": {
            "fetch_ms": fetch_ms,
            "risk_ms": risk_ms,
            "solve_ms": solve_ms,
        },
        "summary": {
            "tracking_error": result.diagnostics.ex_ante_tracking_error,
            "turnover": result.diagnostics.turnover,
            "estimated_tax_cost": result.diagnostics.estimated_tax_cost,
            "estimated_transaction_cost": result.diagnostics.estimated_transaction_cost,
            "trade_count": len(trades),
            "converged": result.diagnostics.converged,
        },
        "trades": trades,
        "lot_dispositions": lot_dispositions,
        "target_weights": target_weights,
        "portfolio": {
            "total_value": round(total_value),
            "cash": round(remaining_cash),
            "currency": preset.get("currency", "JPY"),
            "as_of": as_of,
        },
        "data_range": {
            "start": str(half_year_ago.date()) if hasattr(half_year_ago, 'date') else str(half_year_ago),
            "end": as_of,
            "trading_days": N,
        },
    }
