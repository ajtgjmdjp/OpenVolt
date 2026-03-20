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


} // namespace openvolt
