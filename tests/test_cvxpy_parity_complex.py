"""
Complex cvxpy parity test: portfolio with weight drift and turnover cost.
"""

import sys
sys.path.insert(0, "build")

import numpy as np
import cvxpy as cp
import _openvolt as ov


def test_drifted_portfolio():
    """Portfolio has drifted from benchmark — optimizer must rebalance."""
    N = 5
    cov = np.array([
        [0.040, 0.010, 0.005, 0.002, 0.001],
        [0.010, 0.035, 0.008, 0.003, 0.002],
        [0.005, 0.008, 0.060, 0.004, 0.003],
        [0.002, 0.003, 0.004, 0.025, 0.005],
        [0.001, 0.002, 0.003, 0.005, 0.045],
    ])
    w_bench = np.array([0.30, 0.25, 0.20, 0.15, 0.10])

    # Drifted weights (overweight A, underweight E)
    prices = np.array([200.0, 150.0, 300.0, 100.0, 250.0])
    # Portfolio: A=200 shares, B=100, C=50, D=80, E=10
    shares = [200.0, 100.0, 50.0, 80.0, 10.0]
    values = [s * p for s, p in zip(shares, prices)]
    total = sum(values)  # 40000+15000+15000+8000+2500 = 80500
    w_current = np.array([v / total for v in values])

    lambda_te = 1.0
    lambda_tcost = 0.5

    # --- cvxpy ---
    w = cp.Variable(N)
    t = cp.Variable(N)  # |w - w_current|

    obj = cp.Minimize(
        lambda_te * cp.quad_form(w - w_bench, cov)
        + lambda_tcost * cp.sum(t)
    )
    constraints = [
        cp.sum(w) == 1.0,
        w >= 0.0,
        w <= 1.0,
        w - w_current <= t,
        -(w - w_current) <= t,
        t >= 0,
    ]
    prob = cp.Problem(obj, constraints)
    prob.solve(solver=cp.OSQP, eps_abs=1e-6, eps_rel=1e-6, max_iter=10000)
    cvxpy_w = w.value

    # --- OpenVolt ---
    asset_ids = ["A", "B", "C", "D", "E"]
    lots = [
        ov.TaxLot(i + 1, asset_ids[i], shares[i], 100.0, "2025-01-01")
        for i in range(N)
    ]
    portfolio = ov.PortfolioState(as_of="2026-03-16", cash=0.0, lots=lots)
    risk = ov.FullCovarianceRisk(asset_ids=asset_ids, covariance=cov)
    market = ov.MarketData(
        as_of="2026-03-16",
        asset_ids=asset_ids,
        prices=prices,
        benchmark_weights=w_bench,
        transaction_cost_bps=np.zeros(N),
        risk_model=risk,
    )
    config = ov.OptimizationConfig()
    config.objective.tracking_error = lambda_te
    config.objective.transaction_cost = lambda_tcost
    config.objective.tax_cost = 0.0
    config.min_trade_notional = 0.0

    result = ov.plan_rebalance(
        ov.RebalanceRequest(portfolio=portfolio, market=market, config=config)
    )
    ov_w = np.array(result.target_weights)

    # --- Compare ---
    print("=" * 70)
    print("Drifted Portfolio Parity Test (5 assets, turnover penalty)")
    print("=" * 70)
    print(f"{'Asset':<8} {'Current':>10} {'Bench':>10} {'OpenVolt':>10} {'cvxpy':>10} {'Diff':>10}")
    print("-" * 58)
    for i in range(N):
        diff = abs(ov_w[i] - cvxpy_w[i])
        print(f"{asset_ids[i]:<8} {w_current[i]:>10.4f} {w_bench[i]:>10.4f} "
              f"{ov_w[i]:>10.4f} {cvxpy_w[i]:>10.4f} {diff:>10.2e}")

    max_diff = np.max(np.abs(ov_w - cvxpy_w))
    print(f"\nMax difference: {max_diff:.2e}")
    print(f"OpenVolt TE: {result.diagnostics.ex_ante_tracking_error:.4f}")
    print(f"Turnover: {result.diagnostics.turnover:.4f}")

    tol = 1e-3
    if max_diff < tol:
        print("PASS")
    else:
        print("FAIL")
        sys.exit(1)


if __name__ == "__main__":
    test_drifted_portfolio()
