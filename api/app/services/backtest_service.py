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
                             lambda_te: float = 200.0, lambda_tax: float = 400.0,
                             market_indices: list[str] | None = None,
                             solver: str = "osqp") -> dict:
    """Run a rolling backtest for a preset universe."""

    if not HAS_ENGINE or not HAS_YFINANCE:
        raise RuntimeError("Engine or yfinance not available")

    preset = PRESETS.get(preset_id)
    if not preset:
        raise ValueError(f"Unknown preset: {preset_id}")

    universe = preset["universe"]

    if universe == "dynamic":
        # Resolve dynamic universe via benchmark_service
        from .benchmark_service import resolve_benchmark
        index_id = preset.get("index_id")
        target = preset.get("target_holdings", 0)
        resolved = resolve_benchmark(index_id=index_id, target_holdings=target, period=period)
        tickers = resolved["tickers"]
        bench_w = np.array(resolved["weights"], dtype=float)
    else:
        tickers = list(universe.keys())
        bench_w = np.array([universe[t]["bench_w"] for t in tickers], dtype=float)

    N = len(tickers)

    # Fetch price data
    data = yf.download(tickers, period=period, auto_adjust=True, progress=False)

    # Handle MultiIndex columns + missing tickers
    import pandas as pd
    if isinstance(data.columns, pd.MultiIndex):
        close = data["Close"]
    else:
        close = data[["Close"]].rename(columns={"Close": tickers[0]}) if N == 1 else data["Close"]

    # Keep only tickers that have data, ffill gaps
    available = [t for t in tickers if t in close.columns and close[t].notna().sum() > 30]
    if len(available) < 2:
        raise ValueError(f"Not enough tickers with data: {len(available)}")
    close = close[available].ffill().dropna()
    T = len(close)

    if T < 30:
        raise ValueError(f"Not enough price data: {T} days")

    # Recompute bench_w for available tickers only
    if len(available) < len(tickers):
        avail_set = set(available)
        idx_map = {t: i for i, t in enumerate(tickers)}
        raw_w = np.array([bench_w[idx_map[t]] for t in available])
        bench_w = raw_w / raw_w.sum()  # Renormalize
        tickers = available
        N = len(tickers)

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
    cash_after_tax = cash  # Separate ledger for after-tax simulation

    # Precompute ticker → index map (avoid O(N) list.index() in inner loops)
    ticker_idx = {t: i for i, t in enumerate(tickers)}

    # Benchmark shares (buy-and-hold benchmark)
    bench_shares = [initial_investment * bench_w[i] / prices_0[i] for i in range(N)]

    # Tax engine
    from .tax_engine import TaxConfig, TaxEngine

    tax_config = TaxConfig(
        jurisdiction=preset.get("tax_jurisdiction", "japan"),
        tax_rate=tax_rate,
        settlement_model=preset.get("tax_settlement_model", "source_withholding"),
        fiscal_year_mode=preset.get("fiscal_year_mode", "jan_dec"),
        fiscal_year_start_month=preset.get("fiscal_year_start_month", 1),
        settlement_delay_months=preset.get("settlement_delay_months", 3),
    )
    tax_engine = TaxEngine(tax_config)

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
        current_date = close.index[t].date() if hasattr(close.index[t], 'date') else close.index[t]

        # Settle any due tax periods (annual filing: happens on settlement date)
        settlement_delta = tax_engine.settle_due_periods(current_date)
        if settlement_delta != 0:
            cash_after_tax -= settlement_delta

        # Pre-trade NAV (for return calculation)
        pre_trade_nav = cash
        for lot in lots:
            idx = ticker_idx[lot.asset_id]
            pre_trade_nav += lot.shares * prices_t[idx]

        # Benchmark NAV
        bench_nav = sum(bench_shares[i] * prices_t[i] for i in range(N))

        # Returns (based on pre-trade NAV for consistency)
        port_ret = (pre_trade_nav / prev_nav - 1.0) if t > 0 else 0.0
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
                config.solver = solver

                result = ov.plan_rebalance(ov.RebalanceRequest(portfolio, market, config))

                if result.diagnostics.converged and result.trades:
                    rebalanced = True
                    rebalance_count += 1
                    day_trades = len(result.trades)

                    # Process sells first (for correct tax withholding)
                    day_realized_gain = 0.0
                    sell_trades = [tr for tr in result.trades if tr.side != ov.Side.buy]
                    buy_trades = [tr for tr in result.trades if tr.side == ov.Side.buy]

                    for trade in sell_trades:
                        idx = ticker_idx[trade.asset_id]
                        remaining = trade.shares
                        for lot in lots[:]:
                            if lot.asset_id != trade.asset_id or remaining <= 1e-10:
                                continue
                            sell = min(remaining, lot.shares)
                            sale_price = prices_t[idx]
                            realized = (sale_price - lot.cost_basis_per_share) * sell
                            day_realized_gain += realized
                            cash += sell * sale_price
                            cash_after_tax += sell * sale_price
                            lot.shares -= sell
                            remaining -= sell
                        lots = [l for l in lots if l.shares > 1e-10]

                    # Tax calculation via TaxEngine
                    if day_realized_gain != 0:
                        tax_delta = tax_engine.on_trade(current_date, day_realized_gain)
                        cash_after_tax -= tax_delta

                    # Process buys (using after-tax cash for after-tax simulation)
                    for trade in buy_trades:
                        idx = ticker_idx[trade.asset_id]
                        lots.append(ov.TaxLot(
                            len(lots) + 1, trade.asset_id, trade.shares,
                            float(prices_t[idx]), str(close.index[t].date())
                        ))
                        cash -= trade.notional
                        cash_after_tax -= trade.notional

        # Recompute NAV after trades (both gross and after-tax use same positions)
        holdings_value = sum(
            lot.shares * prices_t[ticker_idx[lot.asset_id]] for lot in lots
        )
        nav = cash + holdings_value
        after_tax_nav = cash_after_tax + holdings_value

        daily_data.append({
            "date": str(close.index[t].date()),
            "nav": round(nav),
            "benchmark_nav": round(bench_nav),
            "after_tax_nav": round(after_tax_nav),
            "portfolio_return": round(port_ret, 6),
            "benchmark_return": round(bench_ret, 6),
            "rolling_te": round(rolling_te, 6),
            "rebalanced": rebalanced,
            "trade_count": day_trades,
            "cumulative_tax_paid": round(tax_engine.cumulative_tax_settled),
            "cumulative_realized_gain": round(tax_engine.cumulative_realized_gain),
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

    # Fetch market index series for overlay (multiple indices supported)
    all_index_series: list[dict] = []

    # Resolve index symbols: explicit > auto-detect from preset
    if market_indices:
        symbols_to_fetch = market_indices
    else:
        pid = preset_id.lower()
        if "topix" in pid or "nikkei" in pid:
            symbols_to_fetch = ["^N225"]
        elif "sp500" in pid or "sp_" in pid or "us_" in pid:
            symbols_to_fetch = ["^GSPC"]
        else:
            symbols_to_fetch = []

    for idx_sym in symbols_to_fetch:
        try:
            idx_data = yf.download(idx_sym, period=period, progress=False)
            if not idx_data.empty:
                idx_close = idx_data["Close"]
                idx_first = float(idx_close.iloc[0].item() if hasattr(idx_close.iloc[0], 'item') else idx_close.iloc[0])
                series = []
                for i in range(len(idx_close)):
                    val = float(idx_close.iloc[i].item() if hasattr(idx_close.iloc[i], 'item') else idx_close.iloc[i])
                    series.append({
                        "date": str(idx_close.index[i].date()),
                        "value": round(val / idx_first * 100, 2),
                    })
                all_index_series.append({"symbol": idx_sym, "series": series})
        except Exception:
            pass

    # Backward compatibility: keep single index_series/index_symbol for existing frontend
    index_series = all_index_series[0]["series"] if all_index_series else None
    index_symbol = all_index_series[0]["symbol"] if all_index_series else None

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
        "index_series": index_series,
        "index_symbol": index_symbol,
        "market_indices": all_index_series,
    }
