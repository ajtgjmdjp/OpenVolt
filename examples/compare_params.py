"""
OpenVolt パラメータ比較: 目的関数の重みを変えて結果を比較

3つのプロファイル:
  1. TE重視     — ベンチマーク追従を優先
  2. バランス   — デフォルト
  3. 税最適     — 税コスト最小化を優先
"""

import sys, json, csv, os
from datetime import datetime
sys.path.insert(0, "build")

import numpy as np
import _openvolt as ov

# ===================================================================
# ユニバース（デモと同じ）
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
prices = np.array([assets[a]["price"] for a in asset_ids], dtype=float)
bench_w = np.array([assets[a]["bench_w"] for a in asset_ids], dtype=float)

# 共分散行列
np.random.seed(42)
factor_loadings = np.random.randn(N, 3) * 0.1 + np.array([1.0, 0.0, 0.0])
specific_vol = np.random.uniform(0.15, 0.35, N)
factor_cov = np.array([[0.04, 0.005, 0.002], [0.005, 0.02, 0.003], [0.002, 0.003, 0.015]])
cov = factor_loadings @ factor_cov @ factor_loadings.T + np.diag(specific_vol**2)
cov = (cov + cov.T) / 2

# ポートフォリオ
lots = [
    ov.TaxLot(1, "7203", 5000, 2500.0, "2025-09-16"),
    ov.TaxLot(2, "6758", 3500, 3500.0, "2025-09-16"),
    ov.TaxLot(3, "8306", 6000, 1500.0, "2025-09-16"),
    ov.TaxLot(4, "6861", 150, 67000.0, "2025-09-16"),
    ov.TaxLot(5, "9984", 1000, 12000.0, "2025-09-16"),
    ov.TaxLot(6, "6501", 2500, 3200.0, "2025-09-16"),
    ov.TaxLot(7, "7741", 400, 17000.0, "2025-09-16"),
    ov.TaxLot(8, "8035", 400, 28000.0, "2025-09-16"),
    ov.TaxLot(9, "4063", 1500, 5100.0, "2025-09-16"),
    ov.TaxLot(10, "9433", 1800, 4200.0, "2025-09-16"),
]

portfolio = ov.PortfolioState(as_of="2026-03-16", cash=2_000_000, lots=lots)
risk = ov.FullCovarianceRisk(asset_ids=asset_ids, covariance=cov)
market = ov.MarketData(
    as_of="2026-03-16", asset_ids=asset_ids, prices=prices,
    benchmark_weights=bench_w, transaction_cost_bps=np.full(N, 5.0),
    risk_model=risk,
)

# ===================================================================
# 3つのプロファイル
# ===================================================================
profiles = {
    "te_focused": {
        "label": "TE重視（ベンチマーク追従優先）",
        "tracking_error": 500.0,
        "transaction_cost": 0.0,
        "tax_cost": 100.0,
    },
    "balanced": {
        "label": "バランス（デフォルト）",
        "tracking_error": 200.0,
        "transaction_cost": 0.0,
        "tax_cost": 400.0,
    },
    "tax_optimal": {
        "label": "税最適（税コスト最小化優先）",
        "tracking_error": 50.0,
        "transaction_cost": 0.0,
        "tax_cost": 800.0,
    },
}

# ===================================================================
# 出力ディレクトリ
# ===================================================================
output_dir = "output"
os.makedirs(output_dir, exist_ok=True)
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

# 総資産計算
total_value = portfolio.cash
for lot in lots:
    idx = asset_ids.index(lot.asset_id)
    total_value += lot.shares * prices[idx]

# ===================================================================
# 各プロファイルで実行
# ===================================================================
all_results = {}

for profile_name, params in profiles.items():
    config = ov.OptimizationConfig()
    config.constraints.max_turnover = 0.15
    config.constraints.cash_buffer = 1_000_000
    for aid in asset_ids:
        config.constraints.weight_bounds[aid] = ov.WeightBound(0.0, 0.20)
    config.taxes.disposal_method = ov.DisposalMethod.specific_id
    config.taxes.short_term_rate = 0.20315
    config.taxes.long_term_rate = 0.20315
    config.taxes.wash_sale_window_days = None
    config.objective.tracking_error = params["tracking_error"]
    config.objective.transaction_cost = params["transaction_cost"]
    config.objective.tax_cost = params["tax_cost"]
    config.min_trade_notional = 100_000
    config.round_to_whole_shares = True

    result = ov.plan_rebalance(
        ov.RebalanceRequest(portfolio=portfolio, market=market, config=config)
    )
    all_results[profile_name] = (params, result)

    # --- JSON 出力 ---
    json_path = os.path.join(output_dir, f"{timestamp}_{profile_name}.json")
    json_data = {
        "profile": profile_name,
        "label": params["label"],
        "objective_weights": {
            "tracking_error": params["tracking_error"],
            "transaction_cost": params["transaction_cost"],
            "tax_cost": params["tax_cost"],
        },
        "diagnostics": {
            "converged": result.diagnostics.converged,
            "solver_status": result.diagnostics.solver_status,
            "ex_ante_tracking_error": result.diagnostics.ex_ante_tracking_error,
            "turnover": result.diagnostics.turnover,
            "estimated_transaction_cost": result.diagnostics.estimated_transaction_cost,
            "estimated_tax_cost": result.diagnostics.estimated_tax_cost,
        },
        "target_weights": {
            asset_ids[i]: result.target_weights[i] for i in range(N)
        },
        "trades": [
            {
                "asset_id": t.asset_id,
                "name": assets[t.asset_id]["name"],
                "side": "buy" if t.side == ov.Side.buy else "sell",
                "shares": t.shares,
                "notional": t.notional,
            }
            for t in result.trades
        ],
        "lot_dispositions": [
            {
                "lot_id": d.lot_id,
                "asset_id": d.asset_id,
                "shares_sold": d.shares_sold,
                "proceeds": d.proceeds,
                "cost_basis": d.cost_basis,
                "realized_gain": d.realized_gain,
                "tax_liability": d.tax_liability,
            }
            for d in result.lot_dispositions
        ],
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False)

# --- CSV: トレードリスト ---
csv_path = os.path.join(output_dir, f"{timestamp}_trades.csv")
with open(csv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["profile", "asset_id", "name", "side", "shares", "notional_jpy"])
    for profile_name, (params, result) in all_results.items():
        for t in result.trades:
            writer.writerow([
                profile_name, t.asset_id, assets[t.asset_id]["name"],
                "buy" if t.side == ov.Side.buy else "sell",
                f"{t.shares:.0f}", f"{t.notional:.0f}",
            ])

# --- CSV: ウェイト比較 ---
weights_path = os.path.join(output_dir, f"{timestamp}_weights.csv")
with open(weights_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    header = ["asset_id", "name", "current_w", "benchmark_w"]
    for pn in profiles:
        header.append(f"target_w_{pn}")
    writer.writerow(header)
    for i, aid in enumerate(asset_ids):
        lot_value = sum(l.shares * prices[i] for l in lots if l.asset_id == aid)
        current_w = lot_value / total_value
        row = [aid, assets[aid]["name"], f"{current_w:.4f}", f"{bench_w[i]:.4f}"]
        for pn in profiles:
            _, result = all_results[pn]
            row.append(f"{result.target_weights[i]:.4f}")
        writer.writerow(row)

# ===================================================================
# 比較表示
# ===================================================================
print("=" * 80)
print("OpenVolt ⚡ パラメータ比較")
print("=" * 80)

# 診断比較
print(f"\n{'指標':<24}", end="")
for pn, (params, _) in all_results.items():
    print(f" {params['label'][:12]:>14}", end="")
print()
print("-" * 68)

metrics = [
    ("追跡誤差 (年率)", lambda r: f"{r.diagnostics.ex_ante_tracking_error:.2%}"),
    ("ターンオーバー", lambda r: f"{r.diagnostics.turnover:.2%}"),
    ("取引件数", lambda r: f"{len(r.trades)}件"),
    ("取引コスト", lambda r: f"¥{r.diagnostics.estimated_transaction_cost:,.0f}"),
    ("推定税コスト", lambda r: f"¥{r.diagnostics.estimated_tax_cost:,.0f}"),
]

for label, fn in metrics:
    print(f"{label:<24}", end="")
    for pn, (_, result) in all_results.items():
        print(f" {fn(result):>14}", end="")
    print()

# ウェイト比較
print(f"\n{'銘柄':>6} {'名前':<12} {'現在':>7} {'ベンチ':>7}", end="")
for pn in profiles:
    short_label = list(profiles.values())[list(profiles.keys()).index(pn)]["label"][:6]
    print(f" {short_label:>7}", end="")
print()
print("-" * 68)

for i, aid in enumerate(asset_ids):
    lot_value = sum(l.shares * prices[i] for l in lots if l.asset_id == aid)
    current_w = lot_value / total_value
    print(f"{aid:>6} {assets[aid]['name'][:12]:<12} {current_w:>6.1%} {bench_w[i]:>6.1%}", end="")
    for pn, (_, result) in all_results.items():
        print(f" {result.target_weights[i]:>6.1%}", end="")
    print()

# ファイル出力情報
print(f"\n📁 出力ファイル:")
print(f"  {csv_path}")
print(f"  {weights_path}")
for pn in profiles:
    print(f"  {output_dir}/{timestamp}_{pn}.json")
print()
