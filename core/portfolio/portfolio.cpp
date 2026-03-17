#include "core/models/position.hpp"
#include "core/models/portfolio.hpp"
#include "core/models/types.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <vector>

namespace openvolt {

// ---------------------------------------------------------------------------
// Portfolio helper functions
// ---------------------------------------------------------------------------

/// Compute portfolio weights from holdings and prices.
Vector compute_weights(
    const Holdings& holdings,
    const std::unordered_map<Ticker, Price>& prices,
    const std::vector<Ticker>& universe
) {
    const int N = static_cast<int>(universe.size());
    Vector weights = Vector::Zero(N);

    double total_value = 0.0;
    for (int i = 0; i < N; ++i) {
        auto it = holdings.find(universe[i]);
        if (it != holdings.end()) {
            auto pit = prices.find(universe[i]);
            if (pit != prices.end()) {
                const double mv = it->second.shares * pit->second;
                weights(i) = mv;
                total_value += mv;
            }
        }
    }

    if (total_value > 0.0) {
        weights /= total_value;
    }
    return weights;
}

/// Compute NAV from holdings, cash, and prices.
Money compute_nav(
    const Holdings& holdings,
    Money cash,
    const std::unordered_map<Ticker, Price>& prices
) {
    Money nav = cash;
    for (const auto& [ticker, pos] : holdings) {
        auto it = prices.find(ticker);
        if (it != prices.end()) {
            nav += pos.shares * it->second;
        }
    }
    return nav;
}

/// Compute daily returns from a series of NAV values.
std::vector<double> compute_daily_returns(const std::vector<Money>& nav_series) {
    std::vector<double> returns;
    returns.reserve(nav_series.size() - 1);
    for (size_t i = 1; i < nav_series.size(); ++i) {
        if (nav_series[i - 1] > 0.0) {
            returns.push_back(nav_series[i] / nav_series[i - 1] - 1.0);
        } else {
            returns.push_back(0.0);
        }
    }
    return returns;
}

/// Compute annualized return from daily returns.
double annualized_return(const std::vector<double>& daily_returns) {
    if (daily_returns.empty()) return 0.0;
    double cumulative = 1.0;
    for (double r : daily_returns) {
        cumulative *= (1.0 + r);
    }
    const double years = static_cast<double>(daily_returns.size()) / 252.0;
    return std::pow(cumulative, 1.0 / years) - 1.0;
}

/// Compute annualized volatility from daily returns.
double annualized_volatility(const std::vector<double>& daily_returns) {
    if (daily_returns.size() < 2) return 0.0;
    const double mean = std::accumulate(daily_returns.begin(), daily_returns.end(), 0.0)
                        / static_cast<double>(daily_returns.size());
    double sum_sq = 0.0;
    for (double r : daily_returns) {
        const double diff = r - mean;
        sum_sq += diff * diff;
    }
    const double daily_vol = std::sqrt(sum_sq / static_cast<double>(daily_returns.size() - 1));
    return daily_vol * std::sqrt(252.0);
}

/// Compute Sharpe ratio (assuming risk-free rate = 0).
double sharpe_ratio(const std::vector<double>& daily_returns) {
    const double vol = annualized_volatility(daily_returns);
    if (vol <= 0.0) return 0.0;
    return annualized_return(daily_returns) / vol;
}

/// Compute maximum drawdown.
double max_drawdown(const std::vector<double>& daily_returns) {
    double peak = 1.0;
    double cumulative = 1.0;
    double max_dd = 0.0;
    for (double r : daily_returns) {
        cumulative *= (1.0 + r);
        peak = std::max(peak, cumulative);
        const double dd = (peak - cumulative) / peak;
        max_dd = std::max(max_dd, dd);
    }
    return max_dd;
}

/// Compute annualized tracking error from daily active returns.
double annualized_tracking_error(const std::vector<double>& active_returns) {
    return annualized_volatility(active_returns);
}

/// Compute information ratio.
double information_ratio(
    const std::vector<double>& portfolio_returns,
    const std::vector<double>& benchmark_returns
) {
    if (portfolio_returns.size() != benchmark_returns.size()) return 0.0;
    std::vector<double> active;
    active.reserve(portfolio_returns.size());
    for (size_t i = 0; i < portfolio_returns.size(); ++i) {
        active.push_back(portfolio_returns[i] - benchmark_returns[i]);
    }
    const double te = annualized_tracking_error(active);
    if (te <= 0.0) return 0.0;
    return annualized_return(active) / te;
}

} // namespace openvolt
