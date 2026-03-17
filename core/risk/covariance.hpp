#pragma once

#include "core/risk/risk_model.hpp"

namespace openvolt {

/// Sample covariance (baseline).
class SampleRiskModel final : public RiskModel {
public:
    explicit SampleRiskModel(int window = 252) : window_(window) {}

    [[nodiscard]] Matrix estimate(
        const Matrix& returns,
        std::span<const Ticker> tickers
    ) const override;

    [[nodiscard]] std::string name() const override { return "sample"; }

private:
    int window_;
};

/// Exponentially Weighted Moving Average covariance.
class EWMARiskModel final : public RiskModel {
public:
    explicit EWMARiskModel(double lambda = 0.97) : lambda_(lambda) {}

    [[nodiscard]] Matrix estimate(
        const Matrix& returns,
        std::span<const Ticker> tickers
    ) const override;

    [[nodiscard]] std::string name() const override { return "ewma"; }

private:
    double lambda_;  // Decay factor (0 < lambda < 1)
};

/// Ledoit-Wolf shrinkage estimator.
class ShrinkageRiskModel final : public RiskModel {
public:
    [[nodiscard]] Matrix estimate(
        const Matrix& returns,
        std::span<const Ticker> tickers
    ) const override;

    [[nodiscard]] std::string name() const override { return "shrinkage"; }
};

/// Statistical factor model covariance.
/// Decomposes returns into factor returns + idiosyncratic.
/// Cov = B * F * B' + D  (B=loadings, F=factor cov, D=diagonal residual)
class FactorRiskModel final : public RiskModel {
public:
    explicit FactorRiskModel(int n_factors = 5, int window = 756, int halflife = 120)
        : n_factors_(n_factors), window_(window), halflife_(halflife) {}

    [[nodiscard]] Matrix estimate(
        const Matrix& returns,
        std::span<const Ticker> tickers
    ) const override;

    [[nodiscard]] std::string name() const override { return "factor"; }

private:
    int n_factors_;
    int window_;
    int halflife_;
};

/// Blend of two risk models (e.g., short-term EWMA + long-term sample).
class BlendRiskModel final : public RiskModel {
public:
    BlendRiskModel(
        std::unique_ptr<RiskModel> short_term,
        std::unique_ptr<RiskModel> long_term,
        double blend_ratio = 0.7  // Weight on short-term
    ) : short_term_(std::move(short_term)),
        long_term_(std::move(long_term)),
        blend_ratio_(blend_ratio) {}

    [[nodiscard]] Matrix estimate(
        const Matrix& returns,
        std::span<const Ticker> tickers
    ) const override;

    [[nodiscard]] std::string name() const override { return "blend"; }

private:
    std::unique_ptr<RiskModel> short_term_;
    std::unique_ptr<RiskModel> long_term_;
    double blend_ratio_;
};

} // namespace openvolt
