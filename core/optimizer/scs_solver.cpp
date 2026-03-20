/// SCS-based QP solver for portfolio optimization.
///
/// Uses SCS 3.x with P matrix (quadratic objective) + cone constraints.
/// Mathematically equivalent formulation to OSQPOptimizer.
///
///   minimize   0.5 * x' P x + c' x
///   subject to Ax + s = b,  s in K (zero cone + nonneg cone)
///
/// Decision variables: x = [w (N), t (N)]
///   w = portfolio weights, t = |w - w_c| auxiliary

#include "core/optimizer/optimizer.hpp"
#include <scs/scs.h>
#include <Eigen/Dense>
#include <Eigen/Sparse>
#include <cmath>
#include <algorithm>
#include <vector>

namespace openvolt {

class SCSOptimizer final : public Optimizer {
public:
    [[nodiscard]] OptimizationResult solve(
        const Vector& benchmark_weights,
        const Vector& current_weights,
        const Matrix& cov,
        const Vector& unrealized_gains,
        const OptimizationParams& params
    ) const override;

    [[nodiscard]] std::string name() const override { return "scs"; }
};

OptimizationResult SCSOptimizer::solve(
    const Vector& benchmark_weights,
    const Vector& current_weights,
    const Matrix& cov,
    const Vector& unrealized_gains,
    const OptimizationParams& params
) const {
    const int N = static_cast<int>(benchmark_weights.size());
    const int n = 2 * N;  // [w(N), t(N)]

    // -----------------------------------------------------------------------
    // P matrix: same as OSQP (upper triangular, only w block)
    // P = [2*lambda_te*Cov,  0]
    //     [0,                0]
    // -----------------------------------------------------------------------
    std::vector<Eigen::Triplet<double, int>> P_triplets;
    for (int i = 0; i < N; ++i) {
        for (int j = i; j < N; ++j) {
            const double val = 2.0 * params.lambda_te * cov(i, j);
            if (std::abs(val) > 1e-12) {
                P_triplets.emplace_back(i, j, val);
            }
        }
    }
    Eigen::SparseMatrix<double, Eigen::ColMajor> P_eigen(n, n);
    P_eigen.setFromTriplets(P_triplets.begin(), P_triplets.end());
    P_eigen.makeCompressed();

    // -----------------------------------------------------------------------
    // c vector (linear objective)
    // c_w = -2 * lambda_te * Cov * w_b
    // c_t = lambda_tcost + per_tcost + tax_penalty
    // -----------------------------------------------------------------------
    std::vector<double> c_vec(n, 0.0);
    Vector c_w = -2.0 * params.lambda_te * cov * benchmark_weights;
    for (int i = 0; i < N; ++i) c_vec[i] = c_w(i);
    for (int i = 0; i < N; ++i) {
        double gain_penalty = 0.0;
        if (unrealized_gains(i) > 0.0) {
            gain_penalty = params.lambda_tax * unrealized_gains(i) * params.tax_rate;
        }
        double per_tcost = (params.tcost_frac.size() > i) ? params.tcost_frac(i) : 0.0;
        c_vec[N + i] = params.lambda_tcost + per_tcost + gain_penalty;
    }

    // -----------------------------------------------------------------------
    // Constraints: Ax + s = b, s in K
    //
    // SCS convention: s = b - Ax, s in K
    //   Zero cone:     s = 0  =>  Ax = b  (equality)
    //   Nonneg cone:   s >= 0  =>  Ax <= b  (inequality)
    //
    // Zero cone (equality):
    //   sum(w) = invest_fraction                                [1 row]
    //
    // Nonneg cone (Ax <= b):
    //   w_i <= ub_i                                              [N rows]
    //   -w_i <= -lb_i  (i.e., w_i >= lb_i)                     [N rows]
    //   -t_i <= 0  (i.e., t_i >= 0)                             [N rows]
    //   w_i - t_i <= w_c_i  (i.e., t_i >= w_i - w_c_i)         [N rows]
    //   -w_i - t_i <= -w_c_i  (i.e., t_i >= w_c_i - w_i)       [N rows]
    //   (optional) sum(t)/2 <= turnover_cap                      [0 or 1]
    // -----------------------------------------------------------------------

    const bool has_turnover = params.turnover_cap < 1.0;
    const int n_nonneg = 5 * N + (has_turnover ? 1 : 0);
    const int m = 1 + n_nonneg;

    std::vector<Eigen::Triplet<double, int>> A_triplets;
    std::vector<double> b(m, 0.0);
    int row = 0;

    // --- Zero cone: sum(w) = invest_fraction ---
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(row, i, 1.0);
    }
    b[row] = params.invest_fraction;
    row++;

    // --- Nonneg cone ---

    // w_i <= ub_i
    for (int i = 0; i < N; ++i) {
        double ub = params.weight_cap;
        auto it = params.per_asset_bounds.find(i);
        if (it != params.per_asset_bounds.end()) ub = it->second.hi;
        if (params.no_buy.count(i)) ub = std::min(ub, current_weights(i));

        A_triplets.emplace_back(row, i, 1.0);
        b[row] = ub;
        row++;
    }

    // -w_i <= -lb_i  (w_i >= lb_i)
    for (int i = 0; i < N; ++i) {
        double lb = 0.0;
        auto it = params.per_asset_bounds.find(i);
        if (it != params.per_asset_bounds.end()) lb = it->second.lo;
        if (params.no_sell.count(i)) lb = std::max(lb, current_weights(i));

        A_triplets.emplace_back(row, i, -1.0);
        b[row] = -lb;
        row++;
    }

    // -t_i <= 0  (t_i >= 0)
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(row, N + i, -1.0);
        b[row] = 0.0;
        row++;
    }

    // w_i - t_i <= w_c_i
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(row, i, 1.0);
        A_triplets.emplace_back(row, N + i, -1.0);
        b[row] = current_weights(i);
        row++;
    }

    // -w_i - t_i <= -w_c_i
    for (int i = 0; i < N; ++i) {
        A_triplets.emplace_back(row, i, -1.0);
        A_triplets.emplace_back(row, N + i, -1.0);
        b[row] = -current_weights(i);
        row++;
    }

    // Optional: sum(t)/2 <= turnover_cap
    if (has_turnover) {
        for (int i = 0; i < N; ++i) {
            A_triplets.emplace_back(row, N + i, 0.5);
        }
        b[row] = params.turnover_cap;
        row++;
    }

    // Build sparse A
    Eigen::SparseMatrix<double, Eigen::ColMajor> A_eigen(m, n);
    A_eigen.setFromTriplets(A_triplets.begin(), A_triplets.end());
    A_eigen.makeCompressed();

    // -----------------------------------------------------------------------
    // Copy indices to scs_int vectors (safe, no reinterpret_cast)
    // -----------------------------------------------------------------------
    const int P_nnz = static_cast<int>(P_eigen.nonZeros());
    const int A_nnz = static_cast<int>(A_eigen.nonZeros());

    std::vector<scs_int> P_i(P_eigen.innerIndexPtr(), P_eigen.innerIndexPtr() + P_nnz);
    std::vector<scs_int> P_p(P_eigen.outerIndexPtr(), P_eigen.outerIndexPtr() + n + 1);
    std::vector<scs_int> A_i(A_eigen.innerIndexPtr(), A_eigen.innerIndexPtr() + A_nnz);
    std::vector<scs_int> A_p(A_eigen.outerIndexPtr(), A_eigen.outerIndexPtr() + n + 1);

    // -----------------------------------------------------------------------
    // SCS setup
    // -----------------------------------------------------------------------
    ScsCone* cone = static_cast<ScsCone*>(calloc(1, sizeof(ScsCone)));
    cone->z = 1;           // Zero cone: 1 equality
    cone->l = n_nonneg;    // Nonneg cone

    ScsSettings* settings = static_cast<ScsSettings*>(calloc(1, sizeof(ScsSettings)));
    scs_set_default_settings(settings);
    settings->verbose = 0;
    settings->eps_abs = 1e-6;
    settings->eps_rel = 1e-6;
    settings->max_iters = 10000;

    ScsMatrix* P_scs = static_cast<ScsMatrix*>(calloc(1, sizeof(ScsMatrix)));
    P_scs->m = n;
    P_scs->n = n;
    P_scs->x = const_cast<double*>(P_eigen.valuePtr());
    P_scs->i = P_i.data();
    P_scs->p = P_p.data();

    ScsMatrix* A_scs = static_cast<ScsMatrix*>(calloc(1, sizeof(ScsMatrix)));
    A_scs->m = m;
    A_scs->n = n;
    A_scs->x = const_cast<double*>(A_eigen.valuePtr());
    A_scs->i = A_i.data();
    A_scs->p = A_p.data();

    ScsData* data = static_cast<ScsData*>(calloc(1, sizeof(ScsData)));
    data->m = m;
    data->n = n;
    data->P = P_scs;
    data->A = A_scs;
    data->b = b.data();
    data->c = c_vec.data();

    ScsSolution* sol = static_cast<ScsSolution*>(calloc(1, sizeof(ScsSolution)));
    sol->x = static_cast<double*>(calloc(n, sizeof(double)));
    sol->y = static_cast<double*>(calloc(m, sizeof(double)));
    sol->s = static_cast<double*>(calloc(m, sizeof(double)));

    ScsInfo info;
    scs_int status = scs(data, cone, settings, sol, &info);

    OptimizationResult result;
    result.converged = false;

    if (status == SCS_SOLVED || status == SCS_SOLVED_INACCURATE) {
        result.converged = true;
        result.target_weights = Eigen::Map<const Vector>(sol->x, N);
        result.objective_value = info.pobj;
        result.solver_status = status == SCS_SOLVED ? "solved" : "solved_inaccurate";

        const Vector active = result.target_weights - benchmark_weights;
        result.predicted_te = std::sqrt(
            std::max(0.0, static_cast<double>(active.transpose() * cov * active)) * 252.0
        );
        result.predicted_turnover = (result.target_weights - current_weights).cwiseAbs().sum() / 2.0;
    } else {
        result.solver_status = info.status;
    }

    free(sol->x); free(sol->y); free(sol->s); free(sol);
    free(data); free(P_scs); free(A_scs); free(cone); free(settings);

    return result;
}

std::unique_ptr<Optimizer> make_scs_optimizer() {
    return std::make_unique<SCSOptimizer>();
}

} // namespace openvolt
