"""
OpenVolt デモ: 実データ（yfinance）を使ったリバランス

1. yfinance で日次株価を取得
2. 共分散行列を計算
3. plan_rebalance() を実行
"""

import sys
sys.path.insert(0, "build")

import numpy as np
import _openvolt as ov

try:
    import yfinance as yf
except ImportError:
    print("pip install yfinance が必要です")
    sys.exit(1)

# ===================================================================
# 1. ユニバース（日本株、Yahoo Finance ティッカー）
# ===================================================================
universe = {
    "7203.T": {"name": "トヨタ自動車",     "bench_w": 0.15},
    "6758.T": {"name": "ソニーグループ",   "bench_w": 0.12},
    "8306.T": {"name": "三菱UFJ",         "bench_w": 0.11},
    "6861.T": {"name": "キーエンス",       "bench_w": 0.10},
    "9984.T": {"name": "ソフトバンクG",    "bench_w": 0.09},
    "6501.T": {"name": "日立製作所",       "bench_w": 0.09},
    "7741.T": {"name": "HOYA",            "bench_w": 0.08},
    "8035.T": {"name": "東京エレクトロン", "bench_w": 0.10},
    "4063.T": {"name": "信越化学工業",     "bench_w": 0.08},
    "9433.T": {"name": "KDDI",            "bench_w": 0.08},
}

tickers = list(universe.keys())
N = len(tickers)

# ===================================================================
# 2. 日次株価取得（過去1年）
# ===================================================================
print("📥 株価データを取得中...")
data = yf.download(tickers, period="1y", auto_adjust=True, progress=False)
close = data["Close"][tickers].dropna()
print(f"  {len(close)} 営業日のデータを取得 ({close.index[0].date()} ~ {close.index[-1].date()})")

# 最新価格
latest_prices = close.iloc[-1].values
print(f"\n📊 最新価格:")
for i, t in enumerate(tickers):
    print(f"  {t:>8} {universe[t]['name']:<16} ¥{latest_prices[i]:>10,.0f}")

# ===================================================================
# 3. 共分散行列を計算（日次リターンから）
# ===================================================================
daily_returns = close.pct_change().dropna()
cov_annual = daily_returns.cov().values * 252  # 年率化
print(f"\n📈 共分散行列を計算（{len(daily_returns)} 日のリターンから、年率化）")

# 各銘柄のボラティリティ
vols = np.sqrt(np.diag(cov_annual))
print(f"  ボラティリティ範囲: {vols.min():.1%} ~ {vols.max():.1%}")

# ===================================================================
# 4. ポートフォリオ構築（6ヶ月前に1億円で購入した仮定）
# ===================================================================
initial_investment = 100_000_000
half_year_ago = close.index[len(close) // 2]
prices_then = close.loc[half_year_ago].values

bench_w = np.array([universe[t]["bench_w"] for t in tickers])

# ベンチマークウェイトに従って購入
lots = []
cash_used = 0
for i, t in enumerate(tickers):
    target_amount = initial_investment * bench_w[i]
    shares = int(target_amount / prices_then[i])  # 整数株
    if shares > 0:
        lots.append(ov.TaxLot(
            lot_id=i + 1,
            asset_id=t,
            shares=float(shares),
            cost_basis_per_share=float(prices_then[i]),
            acquired_on=str(half_year_ago.date()),
        ))
        cash_used += shares * prices_then[i]

remaining_cash = initial_investment - cash_used

# 現在の評価額
total_value = remaining_cash
for lot in lots:
    idx = tickers.index(lot.asset_id)
    total_value += lot.shares * latest_prices[idx]

print(f"\n💼 ポートフォリオ（{half_year_ago.date()} に ¥{initial_investment:,.0f} で構築）")
print(f"  現在総資産: ¥{total_value:,.0f}")
print(f"  損益: ¥{total_value - initial_investment:+,.0f} ({(total_value/initial_investment - 1):+.2%})")

# ===================================================================
# 4.5. ドリフトウェイト計算
# ===================================================================
# ベンチマークも価格変動でドリフトする。
# 構築時のベンチマークウェイトに従って仮想ポートフォリオを作り、
# 現在の価格で再評価してドリフト後のウェイトを計算。
bench_shares = {}
for i, t in enumerate(tickers):
    target_amount = initial_investment * bench_w[i]
    bench_shares[t] = target_amount / prices_then[i]

# 現在価格でのドリフトウェイト
bench_current_values = np.array([bench_shares[t] * latest_prices[i] for i, t in enumerate(tickers)])
drifted_w = bench_current_values / bench_current_values.sum()

print(f"\n📐 ドリフトウェイト（ベンチマーク自体の価格変動を反映）")
print(f"  {'銘柄':>8} {'静的':>7} {'ドリフト':>7} {'差':>7}")
for i, t in enumerate(tickers):
    print(f"  {t:>8} {bench_w[i]:>6.1%} {drifted_w[i]:>7.1%} {drifted_w[i]-bench_w[i]:>+6.1%}")

# ===================================================================
# 5. OpenVolt で最適リバランス
# ===================================================================
# 内部のアセットIDは .T 付きのまま使う
asset_ids = tickers

portfolio = ov.PortfolioState(
    as_of=str(close.index[-1].date()),
    cash=remaining_cash,
    lots=lots,
)

risk = ov.FullCovarianceRisk(
    asset_ids=asset_ids,
    covariance=cov_annual,
)

market = ov.MarketData(
    as_of=str(close.index[-1].date()),
    asset_ids=asset_ids,
    prices=latest_prices,
    benchmark_weights=drifted_w,  # ドリフトウェイトを使う（bloomo方式）
    transaction_cost_bps=np.full(N, 5.0),
    risk_model=risk,
)

config = ov.OptimizationConfig()
config.constraints.max_turnover = 0.15
config.constraints.cash_buffer = 1_000_000
for aid in asset_ids:
    config.constraints.weight_bounds[aid] = ov.WeightBound(0.0, 0.20)
config.taxes.disposal_method = ov.DisposalMethod.specific_id
config.taxes.short_term_rate = 0.20315
config.taxes.long_term_rate = 0.20315
config.taxes.wash_sale_window_days = None
config.objective.tracking_error = 200.0
config.objective.transaction_cost = 0.0
config.objective.tax_cost = 400.0
config.min_trade_notional = 100_000
config.round_to_whole_shares = True

print(f"\n⚡ OpenVolt で最適化中...")
result = ov.plan_rebalance(
    ov.RebalanceRequest(portfolio=portfolio, market=market, config=config)
)

# ===================================================================
# 6. 結果表示
# ===================================================================
print(f"\n{'銘柄':>8} {'名前':<14} {'現在':>7} {'ベンチ':>7} {'最適':>7} {'含み損益':>12}")
print("-" * 66)
for i, t in enumerate(tickers):
    lot = next((l for l in lots if l.asset_id == t), None)
    if lot:
        mv = lot.shares * latest_prices[i]
        current_w = mv / total_value
        pnl = lot.shares * (latest_prices[i] - lot.cost_basis_per_share)
    else:
        current_w = 0.0
        pnl = 0.0
    print(f"{t:>8} {universe[t]['name'][:14]:<14} {current_w:>6.1%} {bench_w[i]:>6.1%} "
          f"{result.target_weights[i]:>6.1%} ¥{pnl:>+11,.0f}")

print(f"\n📋 取引リスト ({len(result.trades)} 件)")
if result.trades:
    print(f"{'銘柄':>8} {'名前':<14} {'売買':>4} {'株数':>8} {'金額':>14}")
    print("-" * 56)
    for t in result.trades:
        name = universe[t.asset_id]["name"][:14]
        side = "買い" if t.side == ov.Side.buy else "売り"
        print(f"{t.asset_id:>8} {name:<14} {side:>4} {t.shares:>8.0f} ¥{t.notional:>13,.0f}")

if result.lot_dispositions:
    print(f"\n💰 税ロット処分 ({len(result.lot_dispositions)} 件)")
    for d in result.lot_dispositions:
        print(f"  Lot#{d.lot_id} {d.asset_id}: {d.shares_sold:.0f}株売却, "
              f"実現損益=¥{d.realized_gain:+,.0f}, 税=¥{d.tax_liability:,.0f}")

print(f"\n📈 診断")
print(f"  収束: {'✅' if result.diagnostics.converged else '❌'}")
print(f"  追跡誤差 (年率): {result.diagnostics.ex_ante_tracking_error:.2%}")
print(f"  ターンオーバー:  {result.diagnostics.turnover:.2%}")
print(f"  取引コスト:     ¥{result.diagnostics.estimated_transaction_cost:,.0f}")
print(f"  推定税コスト:   ¥{result.diagnostics.estimated_tax_cost:,.0f}")
print()
