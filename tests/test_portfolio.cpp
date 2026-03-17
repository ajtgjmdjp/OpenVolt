#include <gtest/gtest.h>
#include "core/models/position.hpp"
#include "core/models/trade.hpp"
#include "core/models/portfolio.hpp"
#include <vector>

using namespace openvolt;

TEST(PositionTest, BasicProperties) {
    Position pos{"AAPL", 100.0, 15000.0};

    EXPECT_EQ(pos.ticker, "AAPL");
    EXPECT_DOUBLE_EQ(pos.shares, 100.0);
    EXPECT_DOUBLE_EQ(pos.cost_basis, 15000.0);
    EXPECT_DOUBLE_EQ(pos.avg_cost(), 150.0);
    EXPECT_DOUBLE_EQ(pos.market_value(200.0), 20000.0);
    EXPECT_DOUBLE_EQ(pos.unrealized_pnl(200.0), 5000.0);
    EXPECT_NEAR(pos.unrealized_pnl_pct(200.0), 5000.0 / 15000.0, 1e-10);
}

TEST(PositionTest, ZeroShares) {
    Position pos{"AAPL", 0.0, 0.0};
    EXPECT_DOUBLE_EQ(pos.avg_cost(), 0.0);
    EXPECT_DOUBLE_EQ(pos.market_value(100.0), 0.0);
    EXPECT_DOUBLE_EQ(pos.unrealized_pnl_pct(100.0), 0.0);
}

TEST(TradeReasonTest, ToString) {
    EXPECT_STREQ(to_string(TradeReason::Rebalance), "REBALANCE");
    EXPECT_STREQ(to_string(TradeReason::TaxLossHarvest), "TLH");
    EXPECT_STREQ(to_string(TradeReason::EmergencyRebalance), "EMERGENCY");
    EXPECT_STREQ(to_string(TradeReason::CashFlow), "CASHFLOW");
    EXPECT_STREQ(to_string(TradeReason::Initial), "INITIAL");
}

// Portfolio helper functions declared in portfolio.cpp
namespace openvolt {
    Money compute_nav(
        const Holdings& holdings,
        Money cash,
        const std::unordered_map<Ticker, Price>& prices
    );
    double annualized_return(const std::vector<double>& daily_returns);
    double annualized_volatility(const std::vector<double>& daily_returns);
    double sharpe_ratio(const std::vector<double>& daily_returns);
    double max_drawdown(const std::vector<double>& daily_returns);
}

TEST(PortfolioTest, ComputeNAV) {
    Holdings holdings;
    holdings["AAPL"] = Position{"AAPL", 100.0, 15000.0};
    holdings["MSFT"] = Position{"MSFT", 50.0, 10000.0};

    std::unordered_map<Ticker, Price> prices;
    prices["AAPL"] = 200.0;
    prices["MSFT"] = 300.0;

    Money nav = compute_nav(holdings, 5000.0, prices);
    // 100*200 + 50*300 + 5000 = 20000 + 15000 + 5000 = 40000
    EXPECT_DOUBLE_EQ(nav, 40000.0);
}

TEST(PortfolioTest, AnnualizedReturn) {
    // 252 days of 0.1% daily return
    std::vector<double> returns(252, 0.001);
    double ann = annualized_return(returns);
    // (1.001)^252 - 1 ≈ 28.6%
    EXPECT_GT(ann, 0.25);
    EXPECT_LT(ann, 0.30);
}

TEST(PortfolioTest, MaxDrawdown) {
    // Simple case: go up, then down
    std::vector<double> returns = {0.10, 0.05, -0.15, -0.10, 0.20};
    double mdd = max_drawdown(returns);
    EXPECT_GT(mdd, 0.0);
    EXPECT_LT(mdd, 1.0);
}

TEST(PortfolioTest, SharpeRatio) {
    // Constant positive returns => high Sharpe
    std::vector<double> returns(100, 0.001);
    double sr = sharpe_ratio(returns);
    EXPECT_GT(sr, 1.0);  // Should be very high with no volatility variation
}
