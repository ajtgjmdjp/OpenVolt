#include "workflows/direct_index.hpp"
#include <algorithm>
#include <cmath>
#include <chrono>

namespace openvolt {

void DirectIndexWorkflow::initialize(
    const EngineConfig& engine_config,
    const RiskModel& risk_model,
    const Optimizer& optimizer
) {
    engine_config_ = engine_config;
    risk_model_ = &risk_model;
    optimizer_ = &optimizer;
}

bool DirectIndexWorkflow::should_rebalance(Date date) const {
    auto ymd = std::chrono::year_month_day{date};
    auto weekday = std::chrono::weekday{date};

    if (config_.rebalance_frequency == "daily") {
        return true;
    } else if (config_.rebalance_frequency == "weekly") {
        // Rebalance on specified day (default Monday=1)
        return weekday.c_encoding() == static_cast<unsigned>(config_.rebalance_day);
    } else if (config_.rebalance_frequency == "monthly") {
        // Rebalance on specified day of month
        return static_cast<unsigned>(ymd.day()) == static_cast<unsigned>(config_.rebalance_day);
    }
    return false;
}

std::vector<TLHAction> DirectIndexWorkflow::scan_tlh_candidates(
    const Holdings& holdings,
    const std::unordered_map<Ticker, Price>& prices,
    Money total_value
) const {
    std::vector<TLHAction> candidates;
    if (!config_.enable_tlh || total_value <= 0.0) return candidates;

    double harvested_pct = 0.0;

    for (const auto& [ticker, pos] : holdings) {
        if (harvested_pct >= config_.tlh_max_harvest_pct) break;

        auto pit = prices.find(ticker);
        if (pit == prices.end()) continue;

        Price current_price = pit->second;
        double loss_pct = pos.unrealized_pnl_pct(current_price);

        // Only harvest if loss exceeds threshold
        if (loss_pct < -config_.tlh_min_loss_pct) {
            double position_weight = pos.market_value(current_price) / total_value;
            double harvestable_weight = std::min(
                position_weight,
                config_.tlh_max_harvest_pct - harvested_pct
            );

            if (harvestable_weight > 0.001) {  // Min 0.1% of portfolio
                Shares sell_shares = pos.shares * (harvestable_weight / position_weight);
                Money estimated_loss = sell_shares * (current_price - pos.avg_cost());

                candidates.push_back({
                    ticker,
                    sell_shares,
                    estimated_loss,
                    "tlh_harvest"
                });
                harvested_pct += harvestable_weight;
            }
        }
    }

    return candidates;
}

StrategyActions DirectIndexWorkflow::on_day(
    Date date,
    const Holdings& holdings,
    Money cash,
    const MarketSnapshot& market,
    const Matrix& returns
) {
    StrategyActions actions;
    days_since_rebalance_++;
    days_since_emergency_++;

    // Compute total portfolio value
    Money total_value = cash;
    for (const auto& [ticker, pos] : holdings) {
        auto pit = market.prices.find(ticker);
        if (pit != market.prices.end()) {
            total_value += pos.market_value(pit->second);
        }
    }

    // --- TLH scan (daily if configured) ---
    if (config_.enable_tlh && config_.tlh_daily && !should_rebalance(date)) {
        auto tlh_candidates = scan_tlh_candidates(holdings, market.prices, total_value);
        for (const auto& tlh : tlh_candidates) {
            auto pit = market.prices.find(tlh.ticker);
            if (pit == market.prices.end()) continue;

            Trade sell_trade;
            sell_trade.date = date;
            sell_trade.ticker = tlh.ticker;
            sell_trade.side = Side::Sell;
            sell_trade.shares = tlh.shares_to_sell;
            sell_trade.price = pit->second;
            sell_trade.amount = tlh.shares_to_sell * pit->second;
            sell_trade.cost_basis = 0.0;  // Filled by engine
            sell_trade.realized_pnl = tlh.estimated_loss;
            sell_trade.reason = TradeReason::TaxLossHarvest;

            actions.trades.push_back(sell_trade);
        }
    }

    // --- Scheduled rebalance ---
    if (should_rebalance(date) && returns.rows() >= 20) {
        // Build universe from market data
        std::vector<Ticker> universe;
        universe.reserve(market.benchmark_weights.size());
        for (const auto& [ticker, weight] : market.benchmark_weights) {
            universe.push_back(ticker);
        }

        if (universe.empty()) {
            actions.skip_rebalance = true;
            return actions;
        }

        const int N = static_cast<int>(universe.size());

        // Build benchmark weight vector
        Vector w_bench = Vector::Zero(N);
        for (int i = 0; i < N; ++i) {
            auto it = market.benchmark_weights.find(universe[i]);
            if (it != market.benchmark_weights.end()) {
                w_bench(i) = it->second;
            }
        }

        // Build current weight vector
        Vector w_current = Vector::Zero(N);
        Vector unrealized_gains = Vector::Zero(N);
        for (int i = 0; i < N; ++i) {
            auto hit = holdings.find(universe[i]);
            auto pit = market.prices.find(universe[i]);
            if (hit != holdings.end() && pit != market.prices.end()) {
                double mv = hit->second.market_value(pit->second);
                w_current(i) = mv / total_value;
                unrealized_gains(i) = hit->second.unrealized_pnl(pit->second) / total_value;
            }
        }

        // Estimate covariance
        // Use only columns corresponding to our universe
        Matrix cov = risk_model_->estimate(returns, universe);

        // Optimize
        auto result = optimizer_->solve(
            w_bench, w_current, cov, unrealized_gains,
            engine_config_.optimization
        );

        if (result.converged) {
            // Generate trades from weight changes
            for (int i = 0; i < N; ++i) {
                double delta_weight = result.target_weights(i) - w_current(i);
                double delta_notional = delta_weight * total_value;

                if (std::abs(delta_notional) < 1000.0) continue;  // Min trade size

                auto pit = market.prices.find(universe[i]);
                if (pit == market.prices.end()) continue;

                Trade trade;
                trade.date = date;
                trade.ticker = universe[i];
                trade.side = delta_weight > 0.0 ? Side::Buy : Side::Sell;
                trade.shares = std::abs(delta_notional) / pit->second;
                trade.price = pit->second;
                trade.amount = std::abs(delta_notional);
                trade.cost_basis = 0.0;
                trade.realized_pnl = 0.0;
                trade.reason = TradeReason::Rebalance;

                actions.trades.push_back(trade);
            }
        }

        days_since_rebalance_ = 0;
        last_rebalance_date_ = date;
    }

    return actions;
}

} // namespace openvolt
