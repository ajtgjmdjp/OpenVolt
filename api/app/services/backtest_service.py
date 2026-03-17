"""Backtest service — runs rolling backtest using C++ engine."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

_build_dir = str(Path(__file__).resolve().parents[3] / "build")
if _build_dir not in sys.path:
    sys.path.insert(0, _build_dir)

try:
    import _openvolt as ov
    HAS_ENGINE = True
except ImportError:
    HAS_ENGINE = False

try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False

from ..data.presets import PRESETS


def run_backtest_from_preset(preset_id: str, risk_model: str = "sample",
                             period: str = "1y", rebalance_frequency: str = "weekly",
                             lambda_te: float = 200.0, lambda_tax: float = 400.0) -> dict:
    """Run a rolling backtest for a preset universe."""

    if not HAS_ENGINE or not HAS_YFINANCE:
        raise RuntimeError("Engine or yfinance not available")

    preset = PRESETS.get(preset_id)
    if not preset:
        raise ValueError(f"Unknown preset: {preset_id}")

    universe = preset["universe"]
    tickers = list(universe.keys())
    N = len(tickers)

    # Fetch price data
    data = yf.download(tickers, period=period, auto_adjust=True, progress=False)
    close = data["Close"][tickers].dropna()
    T = len(close)

    if T < 30:
        raise ValueError(f"Not enough price data: {T} days")

    bench_w = np.array([universe[t]["bench_w"] for t in tickers], dtype=float)
    initial_investment = preset.get("initial_investment", 100_000_000)
    tax_rate = preset.get("tax_rate", 0.20315)

    # Build portfolio at start date
    prices_0 = close.iloc[0].values.astype(float)
    lots = []
    cash_used = 0.0
    for i, t in enumerate(tickers):
        target = initial_investment * bench_w[i]
        shares = int(target / prices_0[i])
        if shares > 0:
            lots.append(ov.TaxLot(i + 1, t, float(shares), float(prices_0[i]),
                                  str(close.index[0].date())))
            cash_used += shares * prices_0[i]

    cash = initial_investment - cash_used

    # Benchmark shares (buy-and-hold benchmark)
    bench_shares = [initial_investment * bench_w[i] / prices_0[i] for i in range(N)]

    # Simulate with weekly rebalancing
    daily_data = []
    prev_nav = initial_investment
    prev_bench = initial_investment
    port_returns = []
    bench_returns = []
    active_returns = []
    rebalance_count = 0

    obj = preset.get("objective", {})
    freq_map = {"daily": 1, "weekly": 5, "monthly": 21}
    rebal_interval = freq_map.get(rebalance_frequency, 5)

    for t in range(T):
        prices_t = close.iloc[t].values.astype(float)

        # Portfolio NAV
        nav = cash
        for lot in lots:
            idx = tickers.index(lot.asset_id)
            nav += lot.shares * prices_t[idx]

        # Benchmark NAV
        bench_nav = sum(bench_shares[i] * prices_t[i] for i in range(N))

        # Returns
        port_ret = (nav / prev_nav - 1.0) if t > 0 else 0.0
        bench_ret = (bench_nav / prev_bench - 1.0) if t > 0 else 0.0
        if t > 0:
            port_returns.append(port_ret)
            bench_returns.append(bench_ret)
            active_returns.append(port_ret - bench_ret)

        # Rolling TE
        rolling_te = 0.0
        if len(active_returns) >= 30:
            window = active_returns[-30:]
            rolling_te = float(np.std(window) * np.sqrt(252))

        rebalanced = False
        day_trades = 0

        # Rebalance
        if t > 20 and t % rebal_interval == 0:
            # Drift weights
            bench_total = sum(bench_shares[i] * prices_t[i] for i in range(N))
            drifted_w = [bench_shares[i] * prices_t[i] / bench_total for i in range(N)]

            # Covariance from returns
            start = max(1, t - 252)
            returns_slice = close.iloc[start:t+1].pct_change().dropna().values
            if len(returns_slice) >= 20:
                cov = np.cov(returns_slice.T) * 252
                # Trace normalize
                tr = np.trace(cov)
                if tr > 1e-12:
                    cov *= N / tr

                risk = ov.FullCovarianceRisk(asset_ids=tickers, covariance=cov)
                portfolio = ov.PortfolioState(
                    as_of=str(close.index[t].date()), cash=cash, lots=lots
                )
                market = ov.MarketData(
                    as_of=str(close.index[t].date()),
                    asset_ids=tickers,
                    prices=prices_t,
                    benchmark_weights=np.array(drifted_w),
                    transaction_cost_bps=np.full(N, 5.0),
                    risk_model=risk,
                )
                config = ov.OptimizationConfig()
                config.constraints.max_turnover = 0.15
                config.constraints.cash_buffer = 1_000_000
                for tk in tickers:
                    config.constraints.weight_bounds[tk] = ov.WeightBound(0.0, 0.20)
                config.objective.tracking_error = lambda_te
                config.objective.transaction_cost = 0.0
                config.objective.tax_cost = lambda_tax
                config.taxes.short_term_rate = tax_rate
                config.taxes.long_term_rate = tax_rate
                config.taxes.wash_sale_window_days = None
                config.min_trade_notional = 100_000
                config.round_to_whole_shares = True

                result = ov.plan_rebalance(ov.RebalanceRequest(portfolio, market, config))

                if result.diagnostics.converged and result.trades:
                    rebalanced = True
                    rebalance_count += 1
                    day_trades = len(result.trades)

                    for trade in result.trades:
                        idx = tickers.index(trade.asset_id)
                        if trade.side == ov.Side.buy:
                            lots.append(ov.TaxLot(
                                len(lots) + 1, trade.asset_id, trade.shares,
                                float(prices_t[idx]), str(close.index[t].date())
                            ))
                            cash -= trade.notional
                        else:
                            remaining = trade.shares
                            for lot in lots[:]:
                                if lot.asset_id != trade.asset_id or remaining <= 1e-10:
                                    continue
                                sell = min(remaining, lot.shares)
                                cash += sell * prices_t[idx]
                                lot.shares -= sell
                                remaining -= sell
                            lots = [l for l in lots if l.shares > 1e-10]

        daily_data.append({
            "date": str(close.index[t].date()),
            "nav": round(nav),
            "benchmark_nav": round(bench_nav),
            "portfolio_return": round(port_ret, 6),
            "benchmark_return": round(bench_ret, 6),
            "rolling_te": round(rolling_te, 6),
            "rebalanced": rebalanced,
            "trade_count": day_trades,
        })

        prev_nav = nav
        prev_bench = bench_nav

    # Summary
    ann_ret = float(np.mean(port_returns) * 252) if port_returns else 0.0
    ann_bench = float(np.mean(bench_returns) * 252) if bench_returns else 0.0
    ann_vol = float(np.std(port_returns) * np.sqrt(252)) if port_returns else 0.0
    ann_te = float(np.std(active_returns) * np.sqrt(252)) if active_returns else 0.0
    mdd = 0.0
    peak = 1.0
    cum = 1.0
    for r in port_returns:
        cum *= (1 + r)
        peak = max(peak, cum)
        mdd = max(mdd, (peak - cum) / peak)

    return {
        "summary": {
            "annualized_return": round(ann_ret, 6),
            "annualized_benchmark_return": round(ann_bench, 6),
            "annualized_volatility": round(ann_vol, 6),
            "annualized_tracking_error": round(ann_te, 6),
            "sharpe_ratio": round(ann_ret / ann_vol, 4) if ann_vol > 0 else 0.0,
            "information_ratio": round((ann_ret - ann_bench) / ann_te, 4) if ann_te > 0 else 0.0,
            "max_drawdown": round(mdd, 6),
            "total_rebalances": rebalance_count,
            "trading_days": T,
            "currency": preset.get("currency", "JPY"),
        },
        "daily": daily_data,
    }
