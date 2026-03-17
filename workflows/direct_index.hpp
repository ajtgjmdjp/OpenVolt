#pragma once

#include "workflows/strategy.hpp"
#include "core/models/tax_lot.hpp"
#include "core/risk/risk_model.hpp"
#include "core/optimizer/optimizer.hpp"
#include "api.hpp"
#include <unordered_map>

namespace openvolt {

/// Direct indexing workflow configuration.
struct DirectIndexConfig {
    // Rebalance schedule
    std::string rebalance_frequency = "weekly";  // "daily", "weekly", "monthly"
    int rebalance_day = 1;  // Day of week (1=Mon) or day of month

    // TLH
    bool enable_tlh = true;
    double tlh_min_loss_pct = 0.05;       // Min loss % to trigger TLH
    double tlh_max_harvest_pct = 0.50;    // Max portfolio % to harvest per day
    bool tlh_daily = true;                // Check TLH every day (not just rebalance)

    // Emergency rebalance
    bool enable_emergency_rebalance = false;
    double te_critical_threshold = 0.025;  // TE > 2.5% triggers emergency
    int emergency_cooldown = 5;            // Days between emergency rebalances
};

/// Tax-Loss Harvesting result for a single asset.
struct TLHAction {
    Ticker ticker;
    Shares shares_to_sell;
    Money estimated_loss;
    std::string reason;  // "tlh_harvest"
};

/// Direct indexing workflow.
///
/// Implements the core direct indexing logic:
/// 1. Track benchmark weights with drift
/// 2. Rebalance on schedule (weekly/monthly)
/// 3. Harvest tax losses daily or on rebalance
/// 4. Emergency rebalance on TE spikes
///
/// This workflow uses plan_rebalance() internally for optimization.
class DirectIndexWorkflow final : public Strategy {
public:
    explicit DirectIndexWorkflow(DirectIndexConfig config = {})
        : config_(std::move(config)) {}

    void initialize(
        const EngineConfig& engine_config,
        const RiskModel& risk_model,
        const Optimizer& optimizer
    ) override;

    [[nodiscard]] StrategyActions on_day(
        Date date,
        const Holdings& holdings,
        Money cash,
        const MarketSnapshot& market,
        const Matrix& returns
    ) override;

    [[nodiscard]] std::string name() const override { return "direct_index"; }

private:
    DirectIndexConfig config_;
    const RiskModel* risk_model_ = nullptr;
    const Optimizer* optimizer_ = nullptr;
    EngineConfig engine_config_;

    int days_since_rebalance_ = 0;
    int days_since_emergency_ = 999;
    Date last_rebalance_date_{};

    // TLH helpers
    [[nodiscard]] std::vector<TLHAction> scan_tlh_candidates(
        const Holdings& holdings,
        const std::unordered_map<Ticker, Price>& prices,
        Money total_value
    ) const;

    // Rebalance trigger
    [[nodiscard]] bool should_rebalance(Date date) const;
};

} // namespace openvolt
