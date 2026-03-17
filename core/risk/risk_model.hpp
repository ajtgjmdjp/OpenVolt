#pragma once

#include "core/models/types.hpp"
#include <memory>
#include <span>
#include <string>

namespace openvolt {

/// Abstract interface for covariance matrix estimation.
///
/// Different implementations provide different estimation methods:
/// - FactorRiskModel: PCA/statistical factor decomposition
/// - EWMARiskModel: Exponentially weighted moving average
/// - ShrinkageRiskModel: Ledoit-Wolf or Oracle Approximating Shrinkage
/// - BlendRiskModel: Weighted combination of short-term and long-term models
class RiskModel {
public:
    virtual ~RiskModel() = default;

    /// Estimate the covariance matrix from a return matrix.
    /// @param returns  T x N matrix (T observations, N assets)
    /// @param tickers  Asset identifiers (length N)
    /// @return N x N covariance matrix
    [[nodiscard]] virtual Matrix estimate(
        const Matrix& returns,
        std::span<const Ticker> tickers
    ) const = 0;

    /// Human-readable name of this risk model.
    [[nodiscard]] virtual std::string name() const = 0;
};

/// Compute ex-ante tracking error.
/// @param active_weights  w_portfolio - w_benchmark (length N)
/// @param cov             N x N covariance matrix
/// @return Annualized tracking error (scalar)
[[nodiscard]] double ex_ante_tracking_error(
    const Vector& active_weights,
    const Matrix& cov
) noexcept;

/// Factory: create a risk model by name.
[[nodiscard]] std::unique_ptr<RiskModel> make_risk_model(
    const std::string& method,
    int window = 252,
    double decay = 0.97
);

} // namespace openvolt
