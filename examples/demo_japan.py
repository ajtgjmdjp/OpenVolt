"""
OpenVolt デモ: 日本株ポートフォリオの税最適リバランス

シナリオ:
- TOPIX Core30 の一部（10銘柄）でダイレクトインデックス
- 初期投資 1億円、6ヶ月前に購入
- 一部銘柄に含み益/含み損あり
- ベンチマークに近づけつつ税コストを最小化
"""

import sys
sys.path.insert(0, "build")

import numpy as np
import _openvolt as ov

# ===================================================================
# 1. ユニバース定義（TOPIX Core30 の一部）
# ===================================================================
assets = {
    "7203": {"name": "トヨタ自動車",     "price": 2850, "bench_w": 0.15},
    "6758": {"name": "ソニーグループ",   "price": 3200, "bench_w": 0.12},
    "8306": {"name": "三菱UFJ",         "price": 1850, "bench_w": 0.11},
    "6861": {"name": "キーエンス",       "price": 68000, "bench_w": 0.10},
    "9984": {"name": "ソフトバンクG",    "price": 9500, "bench_w": 0.09},
    "6501": {"name": "日立製作所",       "price": 3800, "bench_w": 0.09},
    "7741": {"name": "HOYA",            "price": 19500, "bench_w": 0.08},
    "8035": {"name": "東京エレクトロン", "price": 25000, "bench_w": 0.10},
    "4063": {"name": "信越化学工業",     "price": 5200, "bench_w": 0.08},
    "9433": {"name": "KDDI",            "price": 4800, "bench_w": 0.08},
}

asset_ids = list(assets.keys())
N = len(asset_ids)

# ===================================================================
# 2. 現在のポートフォリオ（6ヶ月前に購入、一部ドリフト）
# ===================================================================
lots = [
    # トヨタ: 含み益あり（2500で買った → 今2850）
    ov.TaxLot(1, "7203", 5000, 2500.0, "2025-09-16"),
    # ソニー: 含み損あり（3500で買った → 今3200）
    ov.TaxLot(2, "6758", 3500, 3500.0, "2025-09-16"),
    # 三菱UFJ: 含み益
    ov.TaxLot(3, "8306", 6000, 1500.0, "2025-09-16"),
    # キーエンス: ほぼ変わらず
    ov.TaxLot(4, "6861", 150, 67000.0, "2025-09-16"),
    # ソフトバンクG: 含み損大（12000で買った → 今9500）
    ov.TaxLot(5, "9984", 1000, 12000.0, "2025-09-16"),
    # 日立: 含み益
    ov.TaxLot(6, "6501", 2500, 3200.0, "2025-09-16"),
    # HOYA: 含み益
    ov.TaxLot(7, "7741", 400, 17000.0, "2025-09-16"),
    # 東京エレクトロン: 含み損（28000で買った）
    ov.TaxLot(8, "8035", 400, 28000.0, "2025-09-16"),
    # 信越化学: ほぼ変わらず
    ov.TaxLot(9, "4063", 1500, 5100.0, "2025-09-16"),
    # KDDI: 含み益
    ov.TaxLot(10, "9433", 1800, 4200.0, "2025-09-16"),
]

portfolio = ov.PortfolioState(
    as_of="2026-03-16",
    cash=2_000_000,  # 200万円の現金
    lots=lots,
)

# ===================================================================
# 3. 市場データ
# ===================================================================
prices = np.array([assets[a]["price"] for a in asset_ids], dtype=float)
bench_w = np.array([assets[a]["bench_w"] for a in asset_ids], dtype=float)

# 共分散行列（リアルな相関構造を模擬）
np.random.seed(42)
# 市場ファクター + セクター効果でリアルな共分散を生成
factor_loadings = np.random.randn(N, 3) * 0.1 + np.array([1.0, 0.0, 0.0])
specific_vol = np.random.uniform(0.15, 0.35, N)
factor_cov = np.array([
    [0.04,  0.005, 0.002],
    [0.005, 0.02,  0.003],
    [0.002, 0.003, 0.015],
])
cov = factor_loadings @ factor_cov @ factor_loadings.T + np.diag(specific_vol**2)
cov = (cov + cov.T) / 2  # 対称化

risk = ov.FullCovarianceRisk(asset_ids=asset_ids, covariance=cov)

market = ov.MarketData(
    as_of="2026-03-16",
    asset_ids=asset_ids,
    prices=prices,
    benchmark_weights=bench_w,
    transaction_cost_bps=np.full(N, 5.0),  # 5bps
    risk_model=risk,
)

# ===================================================================
# 4. 最適化設定
# ===================================================================
config = ov.OptimizationConfig()

# 制約
config.constraints.max_turnover = 0.15  # 片道15%
config.constraints.cash_buffer = 1_000_000  # 100万円の現金バッファ

# 個別銘柄のウェイト上限
for aid in asset_ids:
    config.constraints.weight_bounds[aid] = ov.WeightBound(0.0, 0.20)

# 日本の税制
config.taxes.disposal_method = ov.DisposalMethod.specific_id
config.taxes.short_term_rate = 0.20315
config.taxes.long_term_rate = 0.20315  # 日本は長短区分なし
config.taxes.wash_sale_window_days = None  # 日本にwash saleなし

# 目的関数の重み（bloomo 実務水準に合わせたスケール）
config.objective.tracking_error = 200.0
config.objective.transaction_cost = 0.0
config.objective.tax_cost = 400.0

config.min_trade_notional = 100_000  # 最低10万円
config.round_to_whole_shares = True  # 整数株

# ===================================================================
# 5. 最適化実行
# ===================================================================
print("=" * 70)
print("OpenVolt ⚡ 日本株ダイレクトインデックス リバランス")
print("=" * 70)

result = ov.plan_rebalance(
    ov.RebalanceRequest(portfolio=portfolio, market=market, config=config)
)

# ===================================================================
# 6. 結果表示
# ===================================================================

# ポートフォリオ概要
total_value = portfolio.cash
for lot in portfolio.lots:
    idx = asset_ids.index(lot.asset_id)
    total_value += lot.shares * prices[idx]

print(f"\n📊 ポートフォリオ概要")
print(f"  総資産:     ¥{total_value:>14,.0f}")
print(f"  現金:       ¥{portfolio.cash:>14,.0f}")
print(f"  株式:       ¥{total_value - portfolio.cash:>14,.0f}")

# 現在 vs ベンチマーク vs 最適
print(f"\n{'銘柄':>6} {'名前':<16} {'現在':>8} {'ベンチ':>8} {'最適':>8} {'差分':>8}")
print("-" * 62)
for i, aid in enumerate(asset_ids):
    lot_value = sum(
        l.shares * prices[i] for l in lots if l.asset_id == aid
    )
    current_w = lot_value / total_value
    target_w = result.target_weights[i]
    diff = target_w - current_w
    print(f"{aid:>6} {assets[aid]['name']:<16} {current_w:>7.1%} {bench_w[i]:>7.1%} "
          f"{target_w:>7.1%} {diff:>+7.1%}")

# 取引リスト
print(f"\n📋 取引リスト ({len(result.trades)} 件)")
print(f"{'銘柄':>6} {'名前':<16} {'売買':>4} {'株数':>8} {'金額':>14}")
print("-" * 56)
total_buy = 0
total_sell = 0
for t in result.trades:
    name = assets[t.asset_id]["name"]
    side = "買い" if t.side == ov.Side.buy else "売り"
    print(f"{t.asset_id:>6} {name:<16} {side:>4} {t.shares:>8.0f} ¥{t.notional:>13,.0f}")
    if t.side == ov.Side.buy:
        total_buy += t.notional
    else:
        total_sell += t.notional
print(f"{'':>6} {'合計':<16} {'買い':>4} {'':>8} ¥{total_buy:>13,.0f}")
print(f"{'':>6} {'':>16} {'売り':>4} {'':>8} ¥{total_sell:>13,.0f}")

# 税ロット処分
if result.lot_dispositions:
    print(f"\n💰 税ロット処分明細 ({len(result.lot_dispositions)} 件)")
    print(f"{'Lot':>4} {'銘柄':>6} {'株数':>8} {'実現損益':>14} {'税額':>12}")
    print("-" * 52)
    total_gain = 0
    total_tax = 0
    for d in result.lot_dispositions:
        name = assets[d.asset_id]["name"][:8]
        print(f"  #{d.lot_id:<2} {d.asset_id:>6} {d.shares_sold:>8.0f} "
              f"¥{d.realized_gain:>13,.0f} ¥{d.tax_liability:>11,.0f}")
        total_gain += d.realized_gain
        total_tax += d.tax_liability
    print(f"{'合計':>14} {'':>8} ¥{total_gain:>13,.0f} ¥{total_tax:>11,.0f}")

# 診断
print(f"\n📈 診断情報")
print(f"  収束:           {'✅' if result.diagnostics.converged else '❌'}")
print(f"  ソルバー:       {result.diagnostics.solver_status}")
print(f"  追跡誤差 (年率): {result.diagnostics.ex_ante_tracking_error:.2%}")
print(f"  ターンオーバー:  {result.diagnostics.turnover:.2%}")
print(f"  取引コスト:     ¥{result.diagnostics.estimated_transaction_cost:,.0f}")
print(f"  推定税コスト:   ¥{result.diagnostics.estimated_tax_cost:,.0f}")
print()
