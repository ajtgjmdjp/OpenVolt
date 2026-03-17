"""
OpenVolt Visual Demo: Real data + chart output

Output:
  output/rebalance_weights.png    Weight comparison (current vs benchmark vs optimal)
  output/rebalance_trades.png     Trade list
  output/rebalance_tax.png        Unrealized P&L + tax lot dispositions
  output/backtest_nav.png         Backtest NAV + rolling TE
"""

import sys, os
sys.path.insert(0, "build")

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import _openvolt as ov

try:
    import yfinance as yf
except ImportError:
    print("pip install yfinance required")
    sys.exit(1)

plt.rcParams["font.family"] = ["Hiragino Sans", "Arial Unicode MS", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

os.makedirs("output", exist_ok=True)

# ===================================================================
# 1. Data
# ===================================================================
universe = {
    "7203.T": "Toyota",     "6758.T": "Sony",
    "8306.T": "MUFG",       "6861.T": "Keyence",
    "9984.T": "SBG",        "6501.T": "Hitachi",
    "7741.T": "HOYA",       "8035.T": "TEL",
    "4063.T": "Shin-Etsu",  "9433.T": "KDDI",
}
tickers = list(universe.keys())
names = list(universe.values())
N = len(tickers)

bench_w_static = np.array([0.15, 0.12, 0.11, 0.10, 0.09, 0.09, 0.08, 0.10, 0.08, 0.08])

print("Fetching price data...")
data = yf.download(tickers, period="1y", auto_adjust=True, progress=False)
close = data["Close"][tickers].dropna()
print(f"  {len(close)} trading days ({close.index[0].date()} ~ {close.index[-1].date()})")

latest_prices = close.iloc[-1].values
daily_returns = close.pct_change().dropna()
cov_annual = daily_returns.cov().values * 252

# ===================================================================
# 2. Portfolio (built 6 months ago)
# ===================================================================
initial_investment = 100_000_000
half_idx = len(close) // 2
half_year_ago = close.index[half_idx]
prices_then = close.loc[half_year_ago].values

lots = []
cash_used = 0
for i, t in enumerate(tickers):
    target = initial_investment * bench_w_static[i]
    shares = int(target / prices_then[i])
    if shares > 0:
        lots.append(ov.TaxLot(i + 1, t, float(shares), float(prices_then[i]),
                              str(half_year_ago.date())))
        cash_used += shares * prices_then[i]
remaining_cash = initial_investment - cash_used

total_value = remaining_cash
for lot in lots:
    idx = tickers.index(lot.asset_id)
    total_value += lot.shares * latest_prices[idx]

# Drift weights
bench_shares = {t: initial_investment * bench_w_static[i] / prices_then[i]
                for i, t in enumerate(tickers)}
bench_current = np.array([bench_shares[t] * latest_prices[i] for i, t in enumerate(tickers)])
drifted_w = bench_current / bench_current.sum()

current_w = np.zeros(N)
for lot in lots:
    idx = tickers.index(lot.asset_id)
    current_w[idx] = lot.shares * latest_prices[idx] / total_value

# ===================================================================
# 3. Optimization
# ===================================================================
portfolio = ov.PortfolioState(str(close.index[-1].date()), remaining_cash, lots)
risk = ov.FullCovarianceRisk(tickers, cov_annual)
market = ov.MarketData(
    str(close.index[-1].date()), tickers, latest_prices, drifted_w,
    np.full(N, 5.0), risk,
)
config = ov.OptimizationConfig()
config.constraints.max_turnover = 0.15
config.constraints.cash_buffer = 1_000_000
for t in tickers:
    config.constraints.weight_bounds[t] = ov.WeightBound(0.0, 0.20)
config.taxes.short_term_rate = 0.20315
config.taxes.long_term_rate = 0.20315
config.taxes.wash_sale_window_days = None
config.objective.tracking_error = 200.0
config.objective.transaction_cost = 0.0
config.objective.tax_cost = 400.0
config.min_trade_notional = 100_000
config.round_to_whole_shares = True

result = ov.plan_rebalance(ov.RebalanceRequest(portfolio, market, config))
target_w = np.array(result.target_weights)

print(f"\nOptimization complete: TE={result.diagnostics.ex_ante_tracking_error:.2%}, "
      f"Turnover={result.diagnostics.turnover:.2%}")

# ===================================================================
# 4. CSV output (scalable to any number of holdings)
# ===================================================================
import csv, json

csv_path = "output/trades.csv"
with open(csv_path, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["asset_id", "name", "side", "shares", "notional"])
    for t in result.trades:
        w.writerow([t.asset_id, universe[t.asset_id],
                    "buy" if t.side == ov.Side.buy else "sell",
                    f"{t.shares:.0f}", f"{t.notional:.0f}"])
print(f"  output/trades.csv")

weights_path = "output/weights.csv"
with open(weights_path, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["asset_id", "name", "current", "benchmark_drifted", "optimal"])
    for i, t in enumerate(tickers):
        w.writerow([t, universe[t], f"{current_w[i]:.6f}",
                    f"{drifted_w[i]:.6f}", f"{target_w[i]:.6f}"])
print(f"  output/weights.csv")

json_path = "output/result.json"
with open(json_path, "w") as f:
    json.dump({
        "diagnostics": {
            "converged": result.diagnostics.converged,
            "tracking_error": result.diagnostics.ex_ante_tracking_error,
            "turnover": result.diagnostics.turnover,
            "estimated_tax_cost": result.diagnostics.estimated_tax_cost,
            "estimated_transaction_cost": result.diagnostics.estimated_transaction_cost,
        },
        "trades": [{"asset_id": t.asset_id, "side": "buy" if t.side == ov.Side.buy else "sell",
                     "shares": t.shares, "notional": t.notional} for t in result.trades],
        "lot_dispositions": [{"lot_id": d.lot_id, "asset_id": d.asset_id,
                               "shares_sold": d.shares_sold, "realized_gain": d.realized_gain,
                               "tax_liability": d.tax_liability} for d in result.lot_dispositions],
    }, f, indent=2)
print(f"  output/result.json")

# ===================================================================
# 5. Chart: NAV + Rolling TE (scales to any universe size)
# ===================================================================
print("\nRunning backtest...")

# Both portfolio and benchmark start from the same date (half_year_ago)
close_from_build = close.loc[half_year_ago:]
dates = close_from_build.index

# Portfolio NAV (buy & hold from build date)
port_shares = {}
for lot in lots:
    port_shares[lot.asset_id] = lot.shares

port_nav = []
for day_idx in range(len(close_from_build)):
    nav = remaining_cash
    for i, t in enumerate(tickers):
        if t in port_shares:
            nav += port_shares[t] * close_from_build.iloc[day_idx, i]
    port_nav.append(nav)

# Benchmark NAV (same start date, same initial investment)
bench_daily = (close_from_build.pct_change().dropna().values * bench_w_static).sum(axis=1)
bench_nav_series = [initial_investment]
for r in bench_daily:
    bench_nav_series.append(bench_nav_series[-1] * (1 + r))

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={"height_ratios": [3, 1]})

ax1.plot(dates, [v / 1e6 for v in port_nav], label="Portfolio (Buy & Hold)",
         color="#2196F3", linewidth=1.5)
ax1.plot(dates[:len(bench_nav_series)],
         [v / 1e6 for v in bench_nav_series], label="Benchmark (Drifted)",
         color="#FF9800", linewidth=1.5, linestyle="--")
ax1.set_ylabel("NAV (M JPY)")
ax1.set_title(f"OpenVolt ⚡ Portfolio vs Benchmark\n"
              f"Initial ¥{initial_investment/1e6:.0f}M  Built {half_year_ago.date()}")
ax1.legend(loc="upper left")
ax1.grid(alpha=0.3)
ax1.yaxis.set_major_formatter(mticker.FormatStrFormatter("¥%.0fM"))

port_returns = np.diff(port_nav) / port_nav[:-1]
bench_returns_aligned = bench_daily[:len(port_returns)]
active_returns = port_returns - bench_returns_aligned
rolling_te = []
window = 30
for i in range(len(active_returns)):
    if i < window:
        rolling_te.append(np.nan)
    else:
        rolling_te.append(np.std(active_returns[i-window:i]) * np.sqrt(252) * 100)

ax2.plot(dates[1:], rolling_te, color="#9C27B0", linewidth=1)
ax2.set_ylabel("Rolling TE (%)")
ax2.set_xlabel("Date")
ax2.set_title("Tracking Error (30-day Rolling, Annualized)")
ax2.grid(alpha=0.3)
ax2.set_ylim(0, max(x for x in rolling_te if x == x) * 1.3)

fig.tight_layout()
fig.savefig("output/backtest_nav.png", dpi=150)
print("  output/backtest_nav.png")
plt.close(fig)

# ===================================================================
# Summary
# ===================================================================
print(f"\n{'='*60}")
print(f"OpenVolt ⚡ Result Summary")
print(f"{'='*60}")
print(f"  Total Value:     ¥{total_value:>14,.0f}")
print(f"  P&L:             ¥{total_value - initial_investment:>+14,.0f} ({(total_value/initial_investment-1):+.2%})")
print(f"  Tracking Error:   {result.diagnostics.ex_ante_tracking_error:>13.2%}")
print(f"  Turnover:         {result.diagnostics.turnover:>13.2%}")
print(f"  Trades:           {len(result.trades):>13}")
print(f"  Est. Tax Cost:   ¥{result.diagnostics.estimated_tax_cost:>13,.0f}")
print(f"  Est. Txn Cost:   ¥{result.diagnostics.estimated_transaction_cost:>13,.0f}")
print(f"\nOutput files:")
for f in ["backtest_nav.png", "trades.csv", "weights.csv", "result.json"]:
    print(f"  output/{f}")
print()
