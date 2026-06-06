#include "core/simulation/rolling_backtest.hpp"
#include "core/risk/covariance.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <chrono>

namespace openvolt {

// Forward declarations from portfolio.cpp
double annualized_return(const std::vector<double>& daily_returns);
double annualized_volatility(const std::vector<double>& daily_returns);
double max_drawdown(const std::vector<double>& daily_returns);

static bool should_rebalance(Date date, const std::string& frequency, int& days_since) {
    days_since++;
    if (frequency == "daily") return true;

    auto ymd = std::chrono::year_month_day{date};
    auto weekday = std::chrono::weekday{std::chrono::sys_days{date}};

    if (frequency == "weekly") {
        return weekday.c_encoding() == 1;  // Monday
    } else if (frequency == "monthly") {
        return static_cast<unsigned>(ymd.day()) == 1 ||
               (days_since >= 20);  // Fallback: at least every 20 days
    }
    return days_since >= 5;  // Default: weekly
}

BacktestResult run_rolling_backtest(
    const BacktestConfig& config,
    const Matrix& prices,
    const std::vector<Date>& dates,
    BacktestProgress progress
) {
    const int T = static_cast<int>(dates.size());
    const int N = static_cast<int>(config.tickers.size());

    BacktestResult result;

    // Create tax policy
    auto tax_policy = make_tax_policy(config.tax_jurisdiction,
        config.optimization.taxes.short_term_rate,
        config.optimization.taxes.long_term_rate,
        config.optimization.taxes.wash_sale_window_days.value_or(0));

    // Initialize portfolio: buy at benchmark weights on day 0
    std::vector<ov::TaxLot> lots;
    double cash_used = 0.0;
    for (int i = 0; i < N; ++i) {
        double target = config.initial_investment * config.benchmark_weights[i];
        double p0 = prices(0, i);
        if (p0 <= 0.0) continue;
        int shares = static_cast<int>(target / p0);
        if (shares > 0) {
            lots.push_back({
                static_cast<uint64_t>(i + 1),
                config.tickers[i],
                static_cast<double>(shares),
                p0,
                dates[0],
            });
            cash_used += shares * p0;
        }
    }
    double cash = config.initial_investment - cash_used;

    // Track benchmark NAV
    std::vector<double> bench_shares(N);
    for (int i = 0; i < N; ++i) {
        double target = config.initial_investment * config.benchmark_weights[i];
        bench_shares[i] = target / prices(0, i);
    }

    std::vector<double> port_returns;
    std::vector<double> bench_returns;
    std::vector<double> active_returns;
    port_returns.reserve(T);
    bench_returns.reserve(T);
    active_returns.reserve(T);

    double prev_nav = config.initial_investment;
    double prev_bench_nav = config.initial_investment;
    int days_since_rebalance = 0;
    uint64_t next_lot_id = N + 1;

    Money total_realized_pnl = 0.0;
    Money total_tax_paid = 0.0;
    int total_trades = 0;
    int total_rebalances = 0;
    // Per-rebalance turnover = sum(|trade.notional|) / NAV at rebalance time.
    // Average is reported in the summary.
    double total_turnover_ratio = 0.0;

    for (int t = 0; t < T; ++t) {
        // Current prices
        std::vector<double> current_prices(N);
        for (int i = 0; i < N; ++i) {
            current_prices[i] = prices(t, i);
        }

        // Compute NAV
        double nav = cash;
        for (const auto& lot : lots) {
            int idx = -1;
            for (int i = 0; i < N; ++i) {
                if (config.tickers[i] == lot.asset_id) { idx = i; break; }
            }
            if (idx >= 0) nav += lot.shares * current_prices[idx];
        }

        // Benchmark NAV
        double bench_nav = 0.0;
        for (int i = 0; i < N; ++i) {
            bench_nav += bench_shares[i] * current_prices[i];
        }

        // Returns
        double port_ret = t > 0 ? (nav / prev_nav - 1.0) : 0.0;
        double bench_ret = t > 0 ? (bench_nav / prev_bench_nav - 1.0) : 0.0;
        if (t > 0) {
            port_returns.push_back(port_ret);
            bench_returns.push_back(bench_ret);
            active_returns.push_back(port_ret - bench_ret);
        }

        // Rolling TE (30-day)
        double rolling_te = 0.0;
        if (active_returns.size() >= 30) {
            double sum = 0.0, sq_sum = 0.0;
            int w = 30;
            for (size_t k = active_returns.size() - w; k < active_returns.size(); ++k) {
                sum += active_returns[k];
                sq_sum += active_returns[k] * active_returns[k];
            }
            double mean = sum / w;
            double var = sq_sum / w - mean * mean;
            rolling_te = std::sqrt(std::max(0.0, var) * 252.0);
        }

        // Rebalance check
        bool rebalanced = false;
        int day_trades = 0;
        Money day_pnl = 0.0;
        Money day_tax = 0.0;

        if (t > 0 && should_rebalance(dates[t], config.rebalance_frequency, days_since_rebalance)) {
            // Compute return matrix (last risk_window days)
            int start_row = std::max(1, t - config.risk_window);
            int n_rows = t - start_row;

            if (n_rows >= 20) {  // Need enough data
                // Build drift weights
                double bench_total = 0.0;
                for (int i = 0; i < N; ++i) {
                    bench_total += bench_shares[i] * current_prices[i];
                }
                std::vector<double> drifted_w(N);
                for (int i = 0; i < N; ++i) {
                    drifted_w[i] = bench_shares[i] * current_prices[i] / bench_total;
                }

                // Compute covariance
                Matrix returns_mat(n_rows, N);
                for (int r = 0; r < n_rows; ++r) {
                    for (int c = 0; c < N; ++c) {
                        double p_prev = prices(start_row + r - 1, c);
                        double p_curr = prices(start_row + r, c);
                        returns_mat(r, c) = p_prev > 0.0 ? (p_curr / p_prev - 1.0) : 0.0;
                    }
                }

                // Sample covariance * 252
                Vector mean = returns_mat.colwise().mean();
                Matrix centered = returns_mat.rowwise() - mean.transpose();
                Matrix cov = (centered.transpose() * centered) / static_cast<double>(n_rows - 1) * 252.0;

                // Trace normalize
                double trace = cov.trace();
                if (trace > 1e-12) {
                    cov *= static_cast<double>(N) / trace;
                }

                // Build request
                ov::PortfolioState portfolio;
                portfolio.as_of = std::chrono::sys_days{dates[t]};
                portfolio.cash = cash;
                portfolio.lots = lots;

                ov::FullCovarianceRisk risk;
                risk.asset_ids = config.tickers;
                risk.covariance.rows = N;
                risk.covariance.cols = N;
                risk.covariance.values.resize(N * N);
                for (int i = 0; i < N; ++i) {
                    for (int j = 0; j < N; ++j) {
                        risk.covariance.values[i * N + j] = cov(i, j);
                    }
                }

                ov::MarketData market;
                market.as_of = std::chrono::sys_days{dates[t]};
                market.asset_ids = config.tickers;
                market.prices = current_prices;
                market.benchmark_weights = drifted_w;
                market.transaction_cost_bps.assign(N, 5.0);
                market.risk_model = std::move(risk);

                ov::RebalanceRequest request{
                    std::move(portfolio), std::move(market), config.optimization
                };

                auto rebal_result = ov::plan_rebalance(request);

                if (rebal_result.diagnostics.converged) {
                    rebalanced = true;
                    total_rebalances++;
                    days_since_rebalance = 0;

                    double rebal_notional = 0.0;
                    // Execute trades
                    for (const auto& trade : rebal_result.trades) {
                        rebal_notional += std::abs(trade.notional);
                        int idx = -1;
                        for (int i = 0; i < N; ++i) {
                            if (config.tickers[i] == trade.asset_id) { idx = i; break; }
                        }
                        if (idx < 0) continue;

                        if (trade.side == ov::Side::buy) {
                            lots.push_back({
                                next_lot_id++,
                                trade.asset_id,
                                trade.shares,
                                current_prices[idx],
                                dates[t],
                            });
                            cash -= trade.notional;
                        } else {
                            // Sell: remove from lots (FIFO)
                            double remaining = trade.shares;
                            for (auto it = lots.begin(); it != lots.end() && remaining > 1e-10; ) {
                                if (it->asset_id != trade.asset_id) { ++it; continue; }
                                double sell = std::min(remaining, it->shares);
                                double cost = sell * it->cost_basis_per_share;
                                double proceeds = sell * current_prices[idx];
                                double gain = proceeds - cost;

                                day_pnl += gain;
                                if (gain > 0.0) {
                                    day_tax += gain * config.optimization.taxes.short_term_rate;
                                }

                                cash += proceeds;
                                remaining -= sell;
                                it->shares -= sell;
                                if (it->shares <= 1e-10) {
                                    it = lots.erase(it);
                                } else {
                                    ++it;
                                }
                            }
                        }
                        day_trades++;
                    }

                    total_trades += day_trades;
                    total_realized_pnl += day_pnl;
                    total_tax_paid += day_tax;
                    if (nav > 0.0) {
                        total_turnover_ratio += rebal_notional / nav;
                    }

                    result.rebalance_results.push_back(std::move(rebal_result));
                }
            }
        }

        // Record snapshot
        DailySnapshot snap;
        snap.date = dates[t];
        snap.nav = nav;
        snap.benchmark_nav = bench_nav;
        snap.portfolio_return = port_ret;
        snap.benchmark_return = bench_ret;
        snap.active_return = port_ret - bench_ret;
        snap.cumulative_return = nav / config.initial_investment - 1.0;
        snap.cumulative_benchmark_return = bench_nav / config.initial_investment - 1.0;
        snap.rolling_te = rolling_te;
        snap.trade_count = day_trades;
        snap.realized_pnl = day_pnl;
        snap.tax_paid = day_tax;
        snap.rebalanced = rebalanced;

        result.daily_snapshots.push_back(snap);

        prev_nav = nav;
        prev_bench_nav = bench_nav;

        if (progress) {
            progress(t + 1, T, snap);
        }
    }

    // Compute summary
    auto& s = result.summary;
    s.annualized_return = port_returns.empty() ? 0.0 : annualized_return(port_returns);
    s.annualized_benchmark_return = bench_returns.empty() ? 0.0 : annualized_return(bench_returns);
    s.annualized_active_return = s.annualized_return - s.annualized_benchmark_return;
    s.annualized_volatility = port_returns.empty() ? 0.0 : annualized_volatility(port_returns);
    s.annualized_tracking_error = active_returns.empty() ? 0.0 : annualized_volatility(active_returns);
    s.sharpe_ratio = s.annualized_volatility > 0.0 ? s.annualized_return / s.annualized_volatility : 0.0;
    s.information_ratio = s.annualized_tracking_error > 0.0 ? s.annualized_active_return / s.annualized_tracking_error : 0.0;
    s.max_drawdown = port_returns.empty() ? 0.0 : max_drawdown(port_returns);
    s.average_turnover =
        total_rebalances > 0 ? total_turnover_ratio / total_rebalances : 0.0;
    s.total_realized_pnl = total_realized_pnl;
    s.total_tax_paid = total_tax_paid;
    s.total_trades = total_trades;
    s.total_rebalances = total_rebalances;
    s.trading_days = T;

    return result;
}

} // namespace openvolt
