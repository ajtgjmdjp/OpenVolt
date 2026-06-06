#include "core/simulation/engine.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>

namespace openvolt {

// Forward declarations of portfolio helpers (defined in portfolio.cpp)
Money compute_nav(
    const Holdings& holdings,
    Money cash,
    const std::unordered_map<Ticker, Price>& prices
);

Vector compute_weights(
    const Holdings& holdings,
    const std::unordered_map<Ticker, Price>& prices,
    const std::vector<Ticker>& universe
);

double annualized_return(const std::vector<double>& daily_returns);
double annualized_volatility(const std::vector<double>& daily_returns);
double sharpe_ratio(const std::vector<double>& daily_returns);
double max_drawdown(const std::vector<double>& daily_returns);
double annualized_tracking_error(const std::vector<double>& active_returns);
double information_ratio(
    const std::vector<double>& portfolio_returns,
    const std::vector<double>& benchmark_returns
);

// ---------------------------------------------------------------------------
// BacktestEngine
// ---------------------------------------------------------------------------

BacktestEngine::BacktestEngine(
    EngineConfig config,
    std::unique_ptr<RiskModel> risk_model,
    std::unique_ptr<Optimizer> optimizer,
    std::unique_ptr<Strategy> strategy
) : config_(std::move(config)),
    risk_model_(std::move(risk_model)),
    optimizer_(std::move(optimizer)),
    strategy_(std::move(strategy)),
    cash_(0.0) {}

SimulationResult BacktestEngine::run(
    const MarketData& data,
    ProgressCallback progress
) {
    const int T = static_cast<int>(data.dates.size());
    const int N = static_cast<int>(data.universe.size());

    // Initialize strategy
    strategy_->initialize(config_, *risk_model_, *optimizer_);

    // Initialize portfolio with cash
    cash_ = config_.initial_investment;
    holdings_.clear();
    trade_history_.clear();
    snapshots_.clear();
    snapshots_.reserve(T);

    // Build return matrix incrementally
    Matrix returns = Matrix::Zero(0, N);
    Money prev_nav = config_.initial_investment;
    Money prev_bench_nav = config_.initial_investment;

    std::vector<double> portfolio_returns;
    std::vector<double> benchmark_returns;
    portfolio_returns.reserve(T);
    benchmark_returns.reserve(T);

    for (int t = 0; t < T; ++t) {
        // Build price map for today
        std::unordered_map<Ticker, Price> prices;
        for (int i = 0; i < N; ++i) {
            prices[data.universe[i]] = data.prices(t, i);
        }

        // Build market snapshot
        MarketSnapshot market;
        market.date = data.dates[t];
        market.prices = prices;
        if (t < static_cast<int>(data.benchmark_weights.size())) {
            market.benchmark_weights = data.benchmark_weights[t];
        }

        // Compute return matrix (use data up to today)
        if (t >= 1) {
            // Append today's return row
            Vector daily_ret(N);
            for (int i = 0; i < N; ++i) {
                const double prev_price = data.prices(t - 1, i);
                if (prev_price > 0.0) {
                    daily_ret(i) = data.prices(t, i) / prev_price - 1.0;
                } else {
                    daily_ret(i) = 0.0;
                }
            }
            returns.conservativeResize(returns.rows() + 1, N);
            returns.row(returns.rows() - 1) = daily_ret.transpose();
        }

        // Ask strategy for actions
        StrategyActions actions = strategy_->on_day(
            data.dates[t], holdings_, cash_, market, returns
        );

        // Execute trades
        if (!actions.trades.empty()) {
            execute_trades(actions.trades, prices);
            trade_history_.insert(
                trade_history_.end(),
                actions.trades.begin(),
                actions.trades.end()
            );
        }

        // Compute NAV and returns
        const Money nav = compute_nav(holdings_, cash_, prices);
        double port_ret = 0.0;
        double bench_ret = 0.0;
        if (t > 0 && prev_nav > 0.0) {
            port_ret = nav / prev_nav - 1.0;
            portfolio_returns.push_back(port_ret);

            // Simple benchmark return (equal-weighted for now)
            double bench_nav = 0.0;
            for (int i = 0; i < N; ++i) {
                bench_nav += data.prices(t, i) / data.prices(0, i);
            }
            bench_nav = config_.initial_investment * bench_nav / static_cast<double>(N);
            bench_ret = (t > 0 && prev_bench_nav > 0.0)
                        ? bench_nav / prev_bench_nav - 1.0 : 0.0;
            benchmark_returns.push_back(bench_ret);
            prev_bench_nav = bench_nav;
        }

        // Record snapshot
        PortfolioSnapshot snap;
        snap.date = data.dates[t];
        snap.nav = nav;
        snap.cash = cash_;
        snap.daily_return = port_ret;
        snap.total_return = (nav / config_.initial_investment) - 1.0;
        snap.tracking_error = 0.0;  // Computed in summary
        snapshots_.push_back(snap);

        prev_nav = nav;

        // Report progress
        if (progress) {
            progress(t + 1, T);
        }
    }

    // Compute summary
    SimulationResult result;
    result.daily_snapshots = std::move(snapshots_);
    result.trade_history = std::move(trade_history_);
    result.annualized_return = annualized_return(portfolio_returns);
    result.annualized_volatility = annualized_volatility(portfolio_returns);
    result.sharpe_ratio = sharpe_ratio(portfolio_returns);
    result.max_drawdown = max_drawdown(portfolio_returns);

    // Active returns
    std::vector<double> active_returns;
    active_returns.reserve(portfolio_returns.size());
    for (size_t i = 0; i < portfolio_returns.size(); ++i) {
        active_returns.push_back(
            portfolio_returns[i] - (i < benchmark_returns.size() ? benchmark_returns[i] : 0.0)
        );
    }
    result.annualized_tracking_error = annualized_tracking_error(active_returns);
    result.information_ratio = information_ratio(portfolio_returns, benchmark_returns);

    // Trade statistics
    result.total_trades = static_cast<int>(result.trade_history.size());
    result.total_realized_pnl = 0.0;
    result.total_tax_paid = 0.0;
    Money total_notional = 0.0;
    for (const auto& trade : result.trade_history) {
        total_notional += std::abs(trade.notional);
        if (trade.side == Side::Sell) {
            result.total_realized_pnl += trade.realized_pnl;
            if (trade.realized_pnl > 0.0) {
                result.total_tax_paid += trade.realized_pnl * config_.optimization.tax_rate;
            }
        }
    }
    // Turnover as a fraction of starting NAV — total notional traded
    // (buys + sells) divided by initial investment.
    result.turnover = config_.initial_investment > 0.0
                          ? total_notional / config_.initial_investment
                          : 0.0;

    return result;
}

void BacktestEngine::execute_trades(
    const std::vector<Trade>& trades,
    const std::unordered_map<Ticker, Price>& prices
) {
    for (const auto& trade : trades) {
        if (trade.side == Side::Buy) {
            // Buy: increase position, decrease cash
            auto& pos = holdings_[trade.ticker];
            if (pos.ticker.empty()) {
                pos.ticker = trade.ticker;
                pos.shares = 0.0;
                pos.cost_basis = 0.0;
            }
            pos.shares += trade.shares;
            pos.cost_basis += trade.amount;
            cash_ -= trade.amount;
        } else {
            // Sell: decrease position, increase cash
            auto it = holdings_.find(trade.ticker);
            if (it != holdings_.end()) {
                it->second.shares -= trade.shares;
                it->second.cost_basis -= trade.cost_basis;
                cash_ += trade.amount;

                // Remove position if fully sold
                if (it->second.shares <= 1e-10) {
                    holdings_.erase(it);
                }
            }
        }
    }
}

} // namespace openvolt
