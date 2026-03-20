"""Tax calculation engine for backtest simulations.

Supports three settlement models:
- source_withholding: immediate YTD-based withholding (Japan 特定口座)
- annual_filing: accumulate within fiscal period, settle after delay
- custom: user-defined fiscal year and settlement delay

All models use the same period-based architecture. Source withholding
is simply annual_filing with settlement_delay=0 and intra-period netting.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from dateutil.relativedelta import relativedelta


@dataclass
class TaxConfig:
    """Tax calculation configuration."""

    jurisdiction: str = "japan"
    tax_rate: float = 0.20315
    settlement_model: str = "source_withholding"
    fiscal_year_mode: str = "jan_dec"  # jan_dec | apr_mar | oct_sep | custom
    fiscal_year_start_month: int = 1
    fiscal_year_start_day: int = 1
    settlement_delay_months: int = 3


@dataclass
class TaxPeriodLedger:
    """Tracks realized gains and tax for one fiscal period."""

    period_id: str
    start_date: date
    end_date: date
    settlement_date: date
    realized_gain_net: float = 0.0
    tax_liability: float = 0.0
    settled: bool = False
    settlement_amount: float = 0.0


class TaxEngine:
    """Period-based tax engine with configurable settlement timing."""

    def __init__(self, config: TaxConfig) -> None:
        self.config = config
        self.periods: list[TaxPeriodLedger] = []
        self.current_period: TaxPeriodLedger | None = None
        self.cumulative_tax_settled: float = 0.0
        self.cumulative_realized_gain: float = 0.0
        # For source_withholding: track YTD liability for delta-based withholding
        self._ytd_tax_liability: float = 0.0

    def _fiscal_year_start(self, d: date) -> date:
        """Return the start date of the fiscal year containing date d."""
        m = self.config.fiscal_year_start_month
        day = self.config.fiscal_year_start_day
        fy_start = date(d.year, m, day)
        if d < fy_start:
            fy_start = date(d.year - 1, m, day)
        return fy_start

    def _fiscal_year_end(self, fy_start: date) -> date:
        """Return the last day of the fiscal year starting at fy_start."""
        return fy_start + relativedelta(years=1, days=-1)

    def _settlement_date(self, fy_end: date) -> date:
        """Return the settlement date after a fiscal year ends."""
        if self.config.settlement_model == "source_withholding":
            # For source withholding, settlement is immediate (handled in on_trade)
            return fy_end
        return fy_end + relativedelta(months=self.config.settlement_delay_months)

    def _ensure_period(self, d: date) -> None:
        """Create a new period if the current one doesn't cover date d."""
        if self.current_period and self.current_period.start_date <= d <= self.current_period.end_date:
            return

        fy_start = self._fiscal_year_start(d)
        fy_end = self._fiscal_year_end(fy_start)
        settlement = self._settlement_date(fy_end)
        period_id = f"FY{fy_start.year}-{fy_end.year}"

        # Finalize previous period if exists
        if self.current_period and not self.current_period.settled:
            self._finalize_period(self.current_period)

        self.current_period = TaxPeriodLedger(
            period_id=period_id,
            start_date=fy_start,
            end_date=fy_end,
            settlement_date=settlement,
        )
        self.periods.append(self.current_period)

        # Reset YTD tracking for source withholding
        if self.config.settlement_model == "source_withholding":
            self._ytd_tax_liability = 0.0

    def _finalize_period(self, period: TaxPeriodLedger) -> None:
        """Calculate final tax for a completed period (annual filing)."""
        period.tax_liability = max(0.0, period.realized_gain_net) * self.config.tax_rate
        period.settlement_amount = period.tax_liability

    def on_trade(self, trade_date: date, realized_gain: float) -> float:
        """Record a realized gain/loss from a trade.

        Returns the immediate cash impact (only non-zero for source_withholding).
        """
        self._ensure_period(trade_date)
        assert self.current_period is not None

        self.current_period.realized_gain_net += realized_gain
        self.cumulative_realized_gain += realized_gain

        if self.config.settlement_model == "source_withholding":
            # Immediate YTD delta-based withholding
            new_liability = max(0.0, self.current_period.realized_gain_net) * self.config.tax_rate
            delta = new_liability - self._ytd_tax_liability
            self._ytd_tax_liability = new_liability
            self.cumulative_tax_settled += delta
            return delta  # Positive = tax paid, negative = refund

        return 0.0  # No immediate cash impact for annual filing

    def settle_due_periods(self, current_date: date) -> float:
        """Settle any periods whose settlement date has arrived.

        Returns total cash impact (positive = tax payment, negative = refund).
        """
        if self.config.settlement_model == "source_withholding":
            return 0.0  # Already settled in on_trade

        total_delta = 0.0
        for period in self.periods:
            if period.settled:
                continue
            if current_date >= period.settlement_date:
                self._finalize_period(period)
                period.settled = True
                total_delta += period.settlement_amount
                self.cumulative_tax_settled += period.settlement_amount

        return total_delta

    def accrued_unsettled_tax(self) -> float:
        """Return tax accrued but not yet settled (for annual filing display)."""
        total = 0.0
        for period in self.periods:
            if not period.settled:
                total += max(0.0, period.realized_gain_net) * self.config.tax_rate
        return total
