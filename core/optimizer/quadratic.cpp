#include "core/optimizer/optimizer.hpp"
#include <osqp.h>
#include <Eigen/Sparse>
#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>

namespace openvolt {

namespace {

// Sparse-matrix sentinel: drop quadratic terms smaller than this when
// building the OSQP P matrix to keep the factorization sparse.
constexpr double TRIPLET_EPSILON = 1e-12;
// "Practically infinite" bound used for inequalities that are only
// one-sided in our formulation. OSQP treats values outside +/- OSQP_INFTY
// as no bound; we use 1e30 for safety against tightening defaults.
constexpr double UNBOUNDED = 1e30;
constexpr double OSQP_EPS_ABS = 1e-6;
constexpr double OSQP_EPS_REL = 1e-6;
constexpr int OSQP_MAX_ITER = 10000;
constexpr double TRADING_DAYS_PER_YEAR = 252.0;

// RAII guard so an exception or early return between osqp_setup() and
// osqp_cleanup() never leaks the solver.
struct OsqpSolverDeleter {
    void operator()(OSQPSolver* s) const noexcept {
        if (s != nullptr) {
            osqp_cleanup(s);
        }
    }
};
using OsqpSolverPtr = std::unique_ptr<OSQPSolver, OsqpSolverDeleter>;

} // namespace

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
    P_triplets.reserve(static_cast<std::size_t>(N) * static_cast<std::size_t>(N));
    for (int i = 0; i < N; ++i) {
        for (int j = i; j < N; ++j) {
            const double val = 2.0 * params.lambda_te * cov(i, j);
            if (std::abs(val) > TRIPLET_EPSILON) {
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
    // q_t = (lambda_tcost + per_asset_tcost) + lambda_tax * max(0, gain) * tax_rate
    // -----------------------------------------------------------------------
    Vector q(n_vars);
    q.head(N) = -2.0 * params.lambda_te * cov * benchmark_weights;
    for (int i = 0; i < N; ++i) {
        double gain_penalty = 0.0;
        if (unrealized_gains(i) > 0.0) {
            gain_penalty = params.lambda_tax * unrealized_gains(i) * params.tax_rate;
        }
        double per_asset_tcost = (params.tcost_frac.size() > i) ? params.tcost_frac(i) : 0.0;
        q(N + i) = params.lambda_tcost + per_asset_tcost + gain_penalty;
    }

    // -----------------------------------------------------------------------
    // Build A matrix and bounds (constraints)
    //
    // Row 0:          sum(w) = invest_fraction
    // Rows 1..N:      lb <= w_i <= ub  (per-asset bounds + no_buy/no_sell)
    // Rows N+1..2N:   w_i - t_i <= w_c_i
    // Rows 2N+1..3N:  -w_i - t_i <= -w_c_i
    // Rows 3N+1..4N:  t_i >= 0
    // Row 4N+1:       sum(t)/2 <= turnover_cap (optional)
    // -----------------------------------------------------------------------
    const bool has_turnover = params.turnover_cap < 1.0;
    const int n_constraints = 1 + N + 2 * N + N + (has_turnover ? 1 : 0);
    std::vector<Eigen::Triplet<double>> A_triplets;

    // Row 0: sum(w) = invest_fraction
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(0, i, 1.0);
    }

    // Rows 1..N: w_i bounds (handled via l/u)
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + i, i, 1.0);
    }

    // Rows N+1..2N: w_i - t_i <= w_c_i
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + N + i, i, 1.0);
        A_triplets.emplace_back(1 + N + i, N + i, -1.0);
    }

    // Rows 2N+1..3N: -w_i - t_i <= -w_c_i
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + 2 * N + i, i, -1.0);
        A_triplets.emplace_back(1 + 2 * N + i, N + i, -1.0);
    }

    // Rows 3N+1..4N: t_i >= 0
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(1 + 3 * N + i, N + i, 1.0);
    }

    // Optional turnover constraint: sum(t)/2 <= turnover_cap
    if (has_turnover) {
        for (int i = 0; i < N; ++i) {
            A_triplets.emplace_back(1 + 4 * N, N + i, 0.5);
        }
    }

    Eigen::SparseMatrix<double, Eigen::ColMajor, OSQPInt> A_eigen(n_constraints, n_vars);
    A_eigen.setFromTriplets(A_triplets.begin(), A_triplets.end());
    A_eigen.makeCompressed();

    // Bounds
    Vector l(n_constraints), u(n_constraints);

    // Row 0: sum(w) = invest_fraction
    l(0) = params.invest_fraction;
    u(0) = params.invest_fraction;

    // Rows 1..N: per-asset weight bounds with no_buy/no_sell overrides
    for (int i = 0; i < N; ++i) {
        double lb = 0.0;
        double ub = params.weight_cap;

        auto it = params.per_asset_bounds.find(i);
        if (it != params.per_asset_bounds.end()) {
            lb = it->second.lo;
            ub = it->second.hi;
        }
        if (params.no_buy.count(i)) {
            ub = std::min(ub, current_weights(i));
        }
        if (params.no_sell.count(i)) {
            lb = std::max(lb, current_weights(i));
        }
        l(1 + i) = lb;
        u(1 + i) = ub;
    }

    // Rows N+1..2N: w_i - t_i <= w_c_i
    for (int i = 0; i < N; ++i) {
        l(1 + N + i) = -UNBOUNDED;
        u(1 + N + i) = current_weights(i);
    }

    // Rows 2N+1..3N: -w_i - t_i <= -w_c_i
    for (int i = 0; i < N; ++i) {
        l(1 + 2 * N + i) = -UNBOUNDED;
        u(1 + 2 * N + i) = -current_weights(i);
    }

    // Rows 3N+1..4N: t_i >= 0
    for (int i = 0; i < N; ++i) {
        l(1 + 3 * N + i) = 0.0;
        u(1 + 3 * N + i) = UNBOUNDED;
    }

    // Turnover constraint bounds
    if (has_turnover) {
        l(1 + 4 * N) = -UNBOUNDED;
        u(1 + 4 * N) = params.turnover_cap;
    }

    // -----------------------------------------------------------------------
    // Set up OSQP
    // -----------------------------------------------------------------------
    OSQPSolver* raw_solver = nullptr;
    OSQPSettings settings;
    osqp_set_default_settings(&settings);
    settings.verbose = false;
    settings.eps_abs = OSQP_EPS_ABS;
    settings.eps_rel = OSQP_EPS_REL;
    settings.max_iter = OSQP_MAX_ITER;

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
        &raw_solver,
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
        // osqp_setup may have allocated and partially initialized on failure;
        // hand it to the RAII guard so cleanup runs unconditionally.
        OsqpSolverPtr{raw_solver};
        return result;
    }

    // Take ownership now that setup succeeded; cleanup runs on any return path.
    OsqpSolverPtr solver{raw_solver};

    exit_flag = osqp_solve(solver.get());

    if (exit_flag == 0 && solver->info->status_val == OSQP_SOLVED) {
        result.converged = true;
        result.target_weights = Eigen::Map<const Vector>(solver->solution->x, N);
        result.objective_value = solver->info->obj_val;
        result.solver_status = "solved";

        // Compute predicted TE
        const Vector active = result.target_weights - benchmark_weights;
        result.predicted_te = std::sqrt(
            std::max(0.0, static_cast<double>(active.transpose() * cov * active))
            * TRADING_DAYS_PER_YEAR
        );

        // Compute predicted turnover (one-sided: half the L1 distance).
        result.predicted_turnover =
            (result.target_weights - current_weights).cwiseAbs().sum() / 2.0;
    } else {
        result.solver_status = solver->info->status;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

#ifdef OPENVOLT_HAS_SCS
std::unique_ptr<Optimizer> make_scs_optimizer();
#endif

std::unique_ptr<Optimizer> make_optimizer(const std::string& name) {
    if (name == "osqp" || name.empty()) {
        return std::make_unique<OSQPOptimizer>();
    }
#ifdef OPENVOLT_HAS_SCS
    if (name == "scs") {
        return make_scs_optimizer();
    }
#endif
    throw std::invalid_argument("Unknown solver: " + name + ". Available: osqp" +
#ifdef OPENVOLT_HAS_SCS
        ", scs"
#else
        ""
#endif
    );
}

} // namespace openvolt
