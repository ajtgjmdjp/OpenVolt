#pragma once

#include "core/models/config.hpp"
#include "core/models/position.hpp"
#include "core/models/trade.hpp"
#include "core/models/types.hpp"
#include "core/risk/risk_model.hpp"
#include "core/optimizer/optimizer.hpp"
#include <memory>
#include <string>
#include <vector>

namespace openvolt {

/// Market data for a single day.
struct MarketSnapshot {
    Date date;
    std::unordered_map<Ticker, Price> prices;
    std::unordered_map<Ticker, Weight> benchmark_weights;
};

/// Actions a strategy can request on a given day.
struct StrategyActions {
    std::vector<Trade> trades;
    bool skip_rebalance = false;
};

/// Abstract strategy interface.
///
/// A strategy decides what trades to execute given the current portfolio
/// state and market data. The core engine handles execution, NAV tracking,
/// and bookkeeping.
class Strategy {
public:
    virtual ~Strategy() = default;

    /// Called once before simulation starts.
    virtual void initialize(
        const EngineConfig& config,
        const RiskModel& risk_model,
        const Optimizer& optimizer
    ) = 0;

    /// Called each trading day. Return trades to execute.
    /// @param date       Current date
    /// @param holdings   Current portfolio holdings
    /// @param cash       Available cash
    /// @param market     Today's market data
    /// @param returns    Historical return matrix (up to today)
    /// @return Actions to take (trades, etc.)
    [[nodiscard]] virtual StrategyActions on_day(
        Date date,
        const Holdings& holdings,
        Money cash,
        const MarketSnapshot& market,
        const Matrix& returns
    ) = 0;

    /// Human-readable strategy name.
    [[nodiscard]] virtual std::string name() const = 0;
};

} // namespace openvolt
