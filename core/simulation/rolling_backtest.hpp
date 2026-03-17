#pragma once

#include "core/models/types.hpp"
#include "core/models/config.hpp"
#include "core/models/tax_policy.hpp"
#include "core/risk/risk_model.hpp"
#include "core/optimizer/optimizer.hpp"
#include "api.hpp"
#include <memory>
#include <vector>
#include <functional>

namespace openvolt {

/// Configuration for a rolling backtest.
struct BacktestConfig {
    // Universe
    std::vector<Ticker> tickers;
    std::vector<std::string> ticker_names;  // Human-readable names

    // Benchmark
    std::vector<double> benchmark_weights;  // Static weights at construction

    // Portfolio
    Money initial_investment = 100'000'000;
    std::string currency = "JPY";

    // Rebalance schedule
    std::string rebalance_frequency = "weekly";  // "daily", "weekly", "monthly"

    // Optimization parameters (forwarded to plan_rebalance)
    ov::OptimizationConfig optimization;

    // Tax
    std::string tax_jurisdiction = "japan";

    // Risk model
    std::string risk_model = "sample";
    int risk_window = 252;
};

/// A single day's snapshot in the backtest.
struct DailySnapshot {
    Date date;
    Money nav;
    Money benchmark_nav;
    double portfolio_return;
    double benchmark_return;
    double active_return;
    double cumulative_return;
    double cumulative_benchmark_return;
    double rolling_te;  // 30-day rolling, annualized
    int trade_count;
    Money realized_pnl;
    Money tax_paid;
    bool rebalanced;
};

/// Summary of a complete backtest.
struct BacktestSummary {
    double annualized_return;
    double annualized_benchmark_return;
    double annualized_active_return;
    double annualized_volatility;
    double annualized_tracking_error;
    double sharpe_ratio;
    double information_ratio;
    double max_drawdown;
    double average_turnover;
    Money total_realized_pnl;
    Money total_tax_paid;
    int total_trades;
    int total_rebalances;
    int trading_days;
};

/// Complete result of a rolling backtest.
struct BacktestResult {
    BacktestSummary summary;
    std::vector<DailySnapshot> daily_snapshots;
    std::vector<ov::RebalanceResult> rebalance_results;  // One per rebalance event
};

/// Progress callback for backtest.
using BacktestProgress = std::function<void(int current_day, int total_days, const DailySnapshot& snap)>;

/// Run a rolling backtest over historical price data.
///
/// @param config     Backtest configuration
/// @param prices     T x N price matrix (rows = days, cols = assets)
/// @param dates      Trading dates (length T)
/// @param progress   Optional progress callback
/// @return Complete backtest result with daily snapshots and summary
[[nodiscard]] BacktestResult run_rolling_backtest(
    const BacktestConfig& config,
    const Matrix& prices,
    const std::vector<Date>& dates,
    BacktestProgress progress = nullptr
);

} // namespace openvolt
