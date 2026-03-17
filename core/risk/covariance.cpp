#include "core/risk/covariance.hpp"
#include <cmath>
#include <stdexcept>
#include <algorithm>

namespace openvolt {

// ---------------------------------------------------------------------------
// Utility: annualization constant
// ---------------------------------------------------------------------------
static constexpr int TRADING_DAYS_PER_YEAR = 252;

// ---------------------------------------------------------------------------
// ex_ante_tracking_error
// ---------------------------------------------------------------------------
double ex_ante_tracking_error(
    const Vector& active_weights,
    const Matrix& cov
) noexcept {
    // TE = sqrt(w' * Cov * w * 252)
    double variance = active_weights.transpose() * cov * active_weights;
    return std::sqrt(std::max(0.0, variance) * TRADING_DAYS_PER_YEAR);
}

// ---------------------------------------------------------------------------
// SampleRiskModel
// ---------------------------------------------------------------------------
Matrix SampleRiskModel::estimate(
    const Matrix& returns,
    [[maybe_unused]] std::span<const Ticker> tickers
) const {
    const int T = static_cast<int>(returns.rows());
    const int N = static_cast<int>(returns.cols());
    const int effective_T = std::min(T, window_);

    // Use the last `window_` rows
    const Matrix tail = returns.bottomRows(effective_T);

    // Center the returns
    const Vector mean = tail.colwise().mean();
    const Matrix centered = tail.rowwise() - mean.transpose();

    // Sample covariance: (1/(T-1)) * X' * X
    return (centered.transpose() * centered) / static_cast<double>(effective_T - 1);
}

// ---------------------------------------------------------------------------
// EWMARiskModel
// ---------------------------------------------------------------------------
Matrix EWMARiskModel::estimate(
    const Matrix& returns,
    [[maybe_unused]] std::span<const Ticker> tickers
) const {
    const int T = static_cast<int>(returns.rows());
    const int N = static_cast<int>(returns.cols());

    // Initialize with first observation's outer product
    Matrix cov = Matrix::Zero(N, N);

    // Compute EWMA covariance
    // S_t = lambda * S_{t-1} + (1 - lambda) * r_t * r_t'
    const Vector mean = returns.colwise().mean();

    for (int t = 0; t < T; ++t) {
        const Vector r = returns.row(t).transpose() - mean;
        cov = lambda_ * cov + (1.0 - lambda_) * (r * r.transpose());
    }

    // Annualize
    return cov * TRADING_DAYS_PER_YEAR;
}

// ---------------------------------------------------------------------------
// ShrinkageRiskModel (Ledoit-Wolf)
// ---------------------------------------------------------------------------
Matrix ShrinkageRiskModel::estimate(
    const Matrix& returns,
    [[maybe_unused]] std::span<const Ticker> tickers
) const {
    const int T = static_cast<int>(returns.rows());
    const int N = static_cast<int>(returns.cols());

    // Sample covariance
    const Vector mean = returns.colwise().mean();
    const Matrix centered = returns.rowwise() - mean.transpose();
    const Matrix sample = (centered.transpose() * centered) / static_cast<double>(T - 1);

    // Shrinkage target: scaled identity (average variance on diagonal)
    const double mu = sample.trace() / static_cast<double>(N);
    const Matrix target = mu * Matrix::Identity(N, N);

    // Ledoit-Wolf optimal shrinkage intensity
    // delta = sum of squared off-diagonal elements of sample cov
    double delta_sum = 0.0;
    for (int i = 0; i < N; ++i) {
        for (int j = 0; j < N; ++j) {
            if (i != j) {
                delta_sum += sample(i, j) * sample(i, j);
            }
        }
    }

    // Simplified shrinkage intensity estimation
    double beta_sum = 0.0;
    for (int t = 0; t < T; ++t) {
        const Matrix outer = centered.row(t).transpose() * centered.row(t);
        const Matrix diff = outer - sample;
        beta_sum += diff.squaredNorm();
    }
    beta_sum /= (static_cast<double>(T) * static_cast<double>(T));

    const double delta = sample.squaredNorm() - (sample.diagonal().squaredNorm());
    const double shrinkage = std::clamp(beta_sum / delta, 0.0, 1.0);

    // Shrunk covariance = alpha * target + (1 - alpha) * sample
    return (shrinkage * target + (1.0 - shrinkage) * sample) * TRADING_DAYS_PER_YEAR;
}

// ---------------------------------------------------------------------------
// FactorRiskModel
// ---------------------------------------------------------------------------
Matrix FactorRiskModel::estimate(
    const Matrix& returns,
    [[maybe_unused]] std::span<const Ticker> tickers
) const {
    const int T = static_cast<int>(returns.rows());
    const int N = static_cast<int>(returns.cols());
    const int effective_T = std::min(T, window_);
    const int K = std::min(n_factors_, std::min(N, effective_T) - 1);

    const Matrix tail = returns.bottomRows(effective_T);

    // Center returns
    const Vector mean = tail.colwise().mean();
    const Matrix centered = tail.rowwise() - mean.transpose();

    // Apply exponential weights if halflife is specified
    Vector weights = Vector::Ones(effective_T);
    if (halflife_ > 0) {
        const double decay = std::log(2.0) / static_cast<double>(halflife_);
        for (int t = 0; t < effective_T; ++t) {
            weights(t) = std::exp(-decay * static_cast<double>(effective_T - 1 - t));
        }
        weights /= weights.sum();
    } else {
        weights /= static_cast<double>(effective_T);
    }

    // Weighted centered returns
    const Matrix W = weights.asDiagonal();
    const Matrix weighted = W.cwiseSqrt() * centered;

    // SVD for factor decomposition
    Eigen::JacobiSVD<Matrix> svd(weighted, Eigen::ComputeThinU | Eigen::ComputeThinV);

    // Factor loadings: first K columns of V * singular_values
    const Matrix V = svd.matrixV().leftCols(K);
    const Vector S = svd.singularValues().head(K);
    const Matrix B = V * S.asDiagonal();  // N x K loadings

    // Factor returns: U * S
    const Matrix F_returns = svd.matrixU().leftCols(K) * S.asDiagonal();  // T x K

    // Factor covariance: K x K
    const Matrix F_cov = (F_returns.transpose() * W * F_returns);

    // Residual variance (diagonal)
    const Matrix residuals = centered - (F_returns * V.transpose());
    Vector D_diag = Vector::Zero(N);
    for (int i = 0; i < N; ++i) {
        D_diag(i) = (residuals.col(i).array().square() * weights.array()).sum();
    }

    // Cov = B * F_cov * B' + diag(D)
    const Matrix cov = (B * F_cov * B.transpose()).eval() + Matrix(D_diag.asDiagonal());

    return cov * TRADING_DAYS_PER_YEAR;
}

// ---------------------------------------------------------------------------
// BlendRiskModel
// ---------------------------------------------------------------------------
Matrix BlendRiskModel::estimate(
    const Matrix& returns,
    std::span<const Ticker> tickers
) const {
    const Matrix short_cov = short_term_->estimate(returns, tickers);
    const Matrix long_cov = long_term_->estimate(returns, tickers);
    return blend_ratio_ * short_cov + (1.0 - blend_ratio_) * long_cov;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
std::unique_ptr<RiskModel> make_risk_model(
    const std::string& method,
    int window,
    double decay
) {
    if (method == "sample") {
        return std::make_unique<SampleRiskModel>(window);
    } else if (method == "ewma") {
        return std::make_unique<EWMARiskModel>(decay);
    } else if (method == "shrinkage") {
        return std::make_unique<ShrinkageRiskModel>();
    } else if (method == "factor") {
        return std::make_unique<FactorRiskModel>();
    } else if (method == "blend") {
        auto short_term = std::make_unique<EWMARiskModel>(decay);
        auto long_term = std::make_unique<SampleRiskModel>(window);
        return std::make_unique<BlendRiskModel>(
            std::move(short_term), std::move(long_term)
        );
    }
    throw std::invalid_argument("Unknown risk model method: " + method);
}

} // namespace openvolt
