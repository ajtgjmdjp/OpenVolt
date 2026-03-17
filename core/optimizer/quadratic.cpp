#include "core/optimizer/optimizer.hpp"
#include <osqp.h>
#include <Eigen/Sparse>
#include <cmath>
#include <stdexcept>
#include <algorithm>

namespace openvolt {

// ---------------------------------------------------------------------------
// OSQP-based QP Optimizer
// ---------------------------------------------------------------------------
//
// The portfolio optimization problem:
//
//   minimize   lambda_te * (w - w_b)' * Cov * (w - w_b)    [tracking error]
//            + lambda_tcost * |w - w_c|                      [transaction cost]
//            + lambda_tax * sum(max(0, gain_i) * |w_i - w_c_i|)  [tax cost]
//
//   subject to sum(w) = 1
//              0 <= w_i <= weight_cap
//
// We reformulate the absolute values using auxiliary variables to get a QP.
//
// Decision variables: x = [w; t] where w = weights (N), t = |w - w_c| (N)
//
//   minimize   lambda_te * w' * Cov * w - 2 * lambda_te * w_b' * Cov * w
//            + lambda_tcost * sum(t)
//            + lambda_tax * gain_penalty' * t
//
//   subject to sum(w) = 1
//              0 <= w_i <= weight_cap        for all i
//              w_i - w_c_i <= t_i            for all i
//              -(w_i - w_c_i) <= t_i         for all i
//              t_i >= 0                      for all i

class OSQPOptimizer final : public Optimizer {
public:
    [[nodiscard]] OptimizationResult solve(
        const Vector& benchmark_weights,
        const Vector& current_weights,
        const Matrix& cov,
        const Vector& unrealized_gains,
        const OptimizationParams& params
    ) const override;

    [[nodiscard]] std::string name() const override { return "osqp"; }
};

OptimizationResult OSQPOptimizer::solve(
    const Vector& benchmark_weights,
    const Vector& current_weights,
    const Matrix& cov,
    const Vector& unrealized_gains,
    const OptimizationParams& params
) const {
    const int N = static_cast<int>(benchmark_weights.size());
    const int n_vars = 2 * N;  // w (N) + t (N)

    // -----------------------------------------------------------------------
    // Build P matrix (upper triangular of quadratic objective)
    // P = [lambda_te * 2 * Cov,  0]
    //     [0,                    0]
    // -----------------------------------------------------------------------
    std::vector<Eigen::Triplet<double>> P_triplets;
    P_triplets.reserve(N * N);
    for (int i = 0; i < N; ++i) {
        for (int j = i; j < N; ++j) {
            const double val = 2.0 * params.lambda_te * cov(i, j);
            if (std::abs(val) > 1e-12) {
                P_triplets.emplace_back(i, j, val);
            }
        }
    }
    Eigen::SparseMatrix<double, Eigen::ColMajor, OSQPInt> P_eigen(n_vars, n_vars);
    P_eigen.setFromTriplets(P_triplets.begin(), P_triplets.end());
    P_eigen.makeCompressed();

    // -----------------------------------------------------------------------
    // Build q vector (linear objective)
    // q_w = -2 * lambda_te * Cov * w_b
    // q_t = lambda_tcost + lambda_tax * max(0, gain_pct)
    // -----------------------------------------------------------------------
    Vector q(n_vars);
    q.head(N) = -2.0 * params.lambda_te * cov * benchmark_weights;
    for (int i = 0; i < N; ++i) {
        double gain_penalty = 0.0;
        if (unrealized_gains(i) > 0.0) {
            gain_penalty = params.lambda_tax * unrealized_gains(i) * params.tax_rate;
        }
        q(N + i) = params.lambda_tcost + gain_penalty;
    }

    // -----------------------------------------------------------------------
    // Build A matrix and bounds (constraints)
    //
    // Row 0:          sum(w) = 1
    // Rows 1..N:      0 <= w_i <= weight_cap
    // Rows N+1..2N:   w_i - w_c_i - t_i <= 0
    // Rows 2N+1..3N:  -(w_i - w_c_i) - t_i <= 0
    // Rows 3N+1..4N:  t_i >= 0
    // -----------------------------------------------------------------------
    const int n_constraints = 1 + N + 2 * N + N;
    std::vector<Eigen::Triplet<double>> A_triplets;

    // Row 0: sum(w) = 1
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(0, i, 1.0);
    }

    // Rows 1..N: w_i bounds (handled via l/u)
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + i, i, 1.0);
    }

    // Rows N+1..2N: w_i - w_c_i <= t_i  =>  w_i - t_i <= w_c_i
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + N + i, i, 1.0);       // w_i
        A_triplets.emplace_back(1 + N + i, N + i, -1.0);  // -t_i
    }

    // Rows 2N+1..3N: -(w_i - w_c_i) <= t_i  =>  -w_i - t_i <= -w_c_i
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + 2 * N + i, i, -1.0);      // -w_i
        A_triplets.emplace_back(1 + 2 * N + i, N + i, -1.0);  // -t_i
    }

    // Rows 3N+1..4N: t_i >= 0
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + 3 * N + i, N + i, 1.0);
    }

    Eigen::SparseMatrix<double, Eigen::ColMajor, OSQPInt> A_eigen(n_constraints, n_vars);
    A_eigen.setFromTriplets(A_triplets.begin(), A_triplets.end());
    A_eigen.makeCompressed();

    // Bounds
    Vector l(n_constraints), u(n_constraints);

    // Row 0: sum(w) = 1
    l(0) = 1.0;
    u(0) = 1.0;

    // Rows 1..N: 0 <= w_i <= weight_cap
    for (int i = 0; i < N; ++i) {
        l(1 + i) = 0.0;
        u(1 + i) = params.weight_cap;
    }

    // Rows N+1..2N: w_i - t_i <= w_c_i
    for (int i = 0; i < N; ++i) {
        l(1 + N + i) = -1e30;
        u(1 + N + i) = current_weights(i);
    }

    // Rows 2N+1..3N: -w_i - t_i <= -w_c_i
    for (int i = 0; i < N; ++i) {
        l(1 + 2 * N + i) = -1e30;
        u(1 + 2 * N + i) = -current_weights(i);
    }

    // Rows 3N+1..4N: t_i >= 0
    for (int i = 0; i < N; ++i) {
        l(1 + 3 * N + i) = 0.0;
        u(1 + 3 * N + i) = 1e30;
    }

    // -----------------------------------------------------------------------
    // Set up OSQP
    // -----------------------------------------------------------------------
    OSQPSolver* solver = nullptr;
    OSQPSettings settings;
    osqp_set_default_settings(&settings);
    settings.verbose = false;
    settings.eps_abs = 1e-6;
    settings.eps_rel = 1e-6;
    settings.max_iter = 10000;

    // Convert Eigen sparse to OSQP CSC format
    OSQPCscMatrix P_csc;
    P_csc.m = n_vars;
    P_csc.n = n_vars;
    P_csc.nzmax = P_eigen.nonZeros();
    P_csc.x = const_cast<double*>(P_eigen.valuePtr());
    P_csc.i = const_cast<OSQPInt*>(P_eigen.innerIndexPtr());
    P_csc.p = const_cast<OSQPInt*>(P_eigen.outerIndexPtr());
    P_csc.nz = -1;  // CSC format

    OSQPCscMatrix A_csc;
    A_csc.m = n_constraints;
    A_csc.n = n_vars;
    A_csc.nzmax = A_eigen.nonZeros();
    A_csc.x = const_cast<double*>(A_eigen.valuePtr());
    A_csc.i = const_cast<OSQPInt*>(A_eigen.innerIndexPtr());
    A_csc.p = const_cast<OSQPInt*>(A_eigen.outerIndexPtr());
    A_csc.nz = -1;

    OSQPInt exit_flag = osqp_setup(
        &solver,
        &P_csc,
        q.data(),
        &A_csc,
        l.data(),
        u.data(),
        n_constraints,
        n_vars,
        &settings
    );

    OptimizationResult result;
    result.converged = false;

    if (exit_flag != 0) {
        result.solver_status = "OSQP setup failed";
        return result;
    }

    // Solve
    exit_flag = osqp_solve(solver);

    if (exit_flag == 0 && solver->info->status_val == OSQP_SOLVED) {
        result.converged = true;
        result.target_weights = Eigen::Map<const Vector>(solver->solution->x, N);
        result.objective_value = solver->info->obj_val;
        result.solver_status = "solved";

        // Compute predicted TE
        const Vector active = result.target_weights - benchmark_weights;
        result.predicted_te = std::sqrt(
            std::max(0.0, static_cast<double>(active.transpose() * cov * active)) * 252.0
        );

        // Compute predicted turnover
        result.predicted_turnover = (result.target_weights - current_weights).cwiseAbs().sum() / 2.0;
    } else {
        result.solver_status = solver->info->status;
    }

    osqp_cleanup(solver);
    return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
std::unique_ptr<Optimizer> make_optimizer() {
    return std::make_unique<OSQPOptimizer>();
}

} // namespace openvolt
