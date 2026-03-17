#pragma once

#include "core/models/config.hpp"
#include "core/models/portfolio.hpp"
#include "core/models/types.hpp"
#include "core/risk/risk_model.hpp"
#include "core/optimizer/optimizer.hpp"
#include "workflows/strategy.hpp"
#include <functional>
#include <memory>
#include <vector>

namespace openvolt {

/// Market data feed: provides daily snapshots.
struct MarketData {
    std::vector<Date> dates;
    std::vector<Ticker> universe;         // All tickers in the universe
    Matrix prices;                         // T x N price matrix
    std::vector<std::unordered_map<Ticker, Weight>> benchmark_weights;  // Per-date benchmark weights
};

/// Callback for progress reporting.
using ProgressCallback = std::function<void(int current_day, int total_days)>;

/// The main backtesting engine.
///
/// Orchestrates the simulation loop:
/// 1. Load market data
/// 2. Initialize portfolio
/// 3. For each trading day:
///    a. Update prices
///    b. Compute NAV
///    c. Ask strategy for actions
///    d. Execute trades
///    e. Record snapshot
/// 4. Compute summary statistics
class BacktestEngine {
public:
    BacktestEngine(
        EngineConfig config,
        std::unique_ptr<RiskModel> risk_model,
        std::unique_ptr<Optimizer> optimizer,
        std::unique_ptr<Strategy> strategy
    );

    /// Run the full backtest simulation.
    [[nodiscard]] SimulationResult run(
        const MarketData& data,
        ProgressCallback progress = nullptr
    );

private:
    EngineConfig config_;
    std::unique_ptr<RiskModel> risk_model_;
    std::unique_ptr<Optimizer> optimizer_;
    std::unique_ptr<Strategy> strategy_;

    // Internal state
    Holdings holdings_;
    Money cash_;
    std::vector<Trade> trade_history_;
    std::vector<PortfolioSnapshot> snapshots_;

    // Helper methods
    void initialize_portfolio(const MarketData& data);
    void execute_trades(
        const std::vector<Trade>& trades,
        const std::unordered_map<Ticker, Price>& prices
    );
    PortfolioSnapshot record_snapshot(
        Date date,
        const std::unordered_map<Ticker, Price>& prices,
        double benchmark_return
    );
    SimulationResult compute_summary() const;
};

} // namespace openvolt
