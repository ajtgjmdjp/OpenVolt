"""
cvxpy parity test: solve the same QP problem with both OpenVolt (C++/OSQP)
and cvxpy (Python/OSQP), and verify that the results match.

This validates that the C++ optimization formulation is correct.
"""

import sys
sys.path.insert(0, "build")

import numpy as np
import cvxpy as cp
import _openvolt as ov


def solve_with_openvolt():
    """Solve the rebalance problem using OpenVolt C++ engine."""
    portfolio = ov.PortfolioState(
        as_of="2026-03-16",
        cash=0.0,  # Fully invested for simplicity
        lots=[
            ov.TaxLot(1, "A", 100.0, 100.0, "2025-01-01"),
            ov.TaxLot(2, "B", 50.0, 200.0, "2025-01-01"),
            ov.TaxLot(3, "C", 30.0, 300.0, "2025-01-01"),
        ],
    )

    cov = np.array([
        [0.04,  0.01,  0.005],
        [0.01,  0.03,  0.008],
        [0.005, 0.008, 0.06],
    ])

    risk = ov.FullCovarianceRisk(
        asset_ids=["A", "B", "C"],
        covariance=cov,
    )

    # Prices such that portfolio value = 100*150 + 50*250 + 30*350 = 38000
    prices = np.array([150.0, 250.0, 350.0])
    benchmark_weights = np.array([0.40, 0.35, 0.25])
    tcost_bps = np.array([0.0, 0.0, 0.0])  # No transaction cost for parity

    market = ov.MarketData(
        as_of="2026-03-16",
        asset_ids=["A", "B", "C"],
        prices=prices,
        benchmark_weights=benchmark_weights,
        transaction_cost_bps=tcost_bps,
        risk_model=risk,
    )

    config = ov.OptimizationConfig()
    config.constraints.max_turnover = 1.0  # No turnover constraint
    config.constraints.cash_buffer = 0.0
    config.taxes.disposal_method = ov.DisposalMethod.specific_id
    config.objective.tracking_error = 1.0
    config.objective.transaction_cost = 0.0  # Disabled
    config.objective.tax_cost = 0.0  # Disabled for clean comparison
    config.min_trade_notional = 0.0

    result = ov.plan_rebalance(
        ov.RebalanceRequest(portfolio=portfolio, market=market, config=config)
    )
    return np.array(result.target_weights), result.diagnostics


def solve_with_cvxpy():
    """Solve the same problem using cvxpy for reference."""
    N = 3
    cov = np.array([
        [0.04,  0.01,  0.005],
        [0.01,  0.03,  0.008],
        [0.005, 0.008, 0.06],
    ])
    w_bench = np.array([0.40, 0.35, 0.25])

    w = cp.Variable(N)

    # Objective: minimize tracking error = (w - w_b)' Cov (w - w_b)
    objective = cp.Minimize(cp.quad_form(w - w_bench, cov))

    constraints = [
        cp.sum(w) == 1.0,  # Fully invested
        w >= 0.0,           # Long-only
        w <= 1.0,           # Max weight
    ]

    prob = cp.Problem(objective, constraints)
    prob.solve(solver=cp.OSQP, eps_abs=1e-6, eps_rel=1e-6)

    return w.value, prob.value


def test_parity():
    """Verify that OpenVolt and cvxpy produce matching results."""
    ov_weights, ov_diag = solve_with_openvolt()
    cvxpy_weights, cvxpy_obj = solve_with_cvxpy()

    print("=" * 60)
    print("cvxpy Parity Test")
    print("=" * 60)
    print(f"{'Asset':<8} {'OpenVolt':>12} {'cvxpy':>12} {'Diff':>12}")
    print("-" * 44)
    for i, name in enumerate(["A", "B", "C"]):
        diff = abs(ov_weights[i] - cvxpy_weights[i])
        print(f"{name:<8} {ov_weights[i]:>12.6f} {cvxpy_weights[i]:>12.6f} {diff:>12.2e}")
    print("-" * 44)
    print(f"OpenVolt TE: {ov_diag.ex_ante_tracking_error:.6f}")
    print(f"OpenVolt converged: {ov_diag.converged}")
    print()

    # Check parity within tolerance
    tol = 1e-3  # Allow 0.1% weight difference
    max_diff = np.max(np.abs(ov_weights - cvxpy_weights))
    print(f"Max weight difference: {max_diff:.2e} (tolerance: {tol:.2e})")

    if max_diff < tol:
        print("PASS: OpenVolt matches cvxpy within tolerance")
    else:
        print("FAIL: Results diverge beyond tolerance")
        sys.exit(1)


if __name__ == "__main__":
    test_parity()
