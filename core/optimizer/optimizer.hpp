#pragma once

#include "core/models/types.hpp"
#include <optional>
#include <string>
#include <vector>

namespace openvolt {

/// Parameters for the portfolio optimization problem.
struct OptimizationParams {
    // Objective weights
    double lambda_te    = 200.0;   // Tracking error penalty
    double lambda_tcost = 0.0;     // Transaction cost penalty
    double lambda_tax   = 400.0;   // Tax (realized gains) penalty

    // Constraints
    double weight_cap   = 0.05;    // Max weight per asset (5%)
    double turnover_cap = 1.0;     // Max one-way turnover (100%)

    // Tax parameters
    double tax_rate     = 0.20315; // Japan: 20.315%
};

/// Result of a single optimization solve.
struct OptimizationResult {
    Vector target_weights;         // Optimal portfolio weights
    double objective_value;        // Optimal objective value
    double predicted_te;           // Ex-ante tracking error
    double predicted_turnover;     // Predicted one-way turnover
    bool converged;                // Did the solver converge?
    std::string solver_status;     // Solver status message
};

/// Abstract optimizer interface.
///
/// Given benchmark weights, current weights, a covariance matrix,
/// and optimization parameters, find optimal target weights.
class Optimizer {
public:
    virtual ~Optimizer() = default;

    /// Solve the portfolio optimization problem.
    /// @param benchmark_weights  Target benchmark weights (length N)
    /// @param current_weights    Current portfolio weights (length N)
    /// @param cov                N x N covariance matrix
    /// @param unrealized_gains   Per-asset unrealized gains (length N, for tax penalty)
    /// @param params             Optimization parameters
    /// @return Optimization result with target weights
    [[nodiscard]] virtual OptimizationResult solve(
        const Vector& benchmark_weights,
        const Vector& current_weights,
        const Matrix& cov,
        const Vector& unrealized_gains,
        const OptimizationParams& params
    ) const = 0;

    [[nodiscard]] virtual std::string name() const = 0;
};

/// Factory: create the default QP-based optimizer.
[[nodiscard]] std::unique_ptr<Optimizer> make_optimizer();

} // namespace openvolt
