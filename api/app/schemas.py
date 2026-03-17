"""Pydantic schemas for API request/response."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class NodeStatus(str, Enum):
    idle = "idle"
    running = "running"
    completed = "completed"
    failed = "failed"


class ConstraintsConfig(BaseModel):
    max_turnover: float = 0.15
    cash_buffer: float = 1_000_000
    max_weight: float = 0.20
    num_holdings: Optional[int] = None


class ObjectiveConfig(BaseModel):
    tracking_error: float = 200.0
    transaction_cost: float = 0.0
    tax_cost: float = 400.0


class CreateRunRequest(BaseModel):
    # Preset
    preset_id: str = "jp_topix_demo"
    custom_tickers: Optional[list[str]] = None  # Override preset universe

    # Model selection
    risk_model: str = "sample"  # sample, ewma, shrinkage, factor, blend
    disposal_method: str = "specific_id"  # specific_id, fifo, lifo
    solver: str = "osqp"  # osqp (future: clarabel)
    tax_jurisdiction: str = "japan"  # japan, us

    # Objective weights
    objective: Optional[ObjectiveConfig] = None

    # Constraints
    constraints: Optional[ConstraintsConfig] = None

    # Data
    period: str = "1y"  # 1m, 3m, 6m, 1y, 2y, 3y
    rebalance_frequency: str = "weekly"  # daily, weekly, monthly

    # Tax
    tax_rate: Optional[float] = None  # Override preset tax rate


class CreateBacktestRequest(BaseModel):
    preset_id: str = "jp_topix_demo"
    custom_tickers: Optional[list[str]] = None
    risk_model: str = "sample"
    disposal_method: str = "specific_id"
    tax_jurisdiction: str = "japan"
    objective: Optional[ObjectiveConfig] = None
    constraints: Optional[ConstraintsConfig] = None
    period: str = "1y"
    rebalance_frequency: str = "weekly"
    tax_rate: Optional[float] = None


class MonteCarloRequest(BaseModel):
    preset_id: str = "jp_topix_demo"
    n_simulations: int = 100
    # Parameter perturbation ranges
    lambda_te_range: list[float] = [100.0, 500.0]
    lambda_tax_range: list[float] = [200.0, 800.0]
    return_noise_std: float = 0.02  # Add noise to historical returns
    risk_model: str = "sample"
    period: str = "1y"


class SweepRequest(BaseModel):
    preset_id: str = "jp_topix_demo"
    sweep_param: str = "lambda_te"  # Which parameter to sweep
    sweep_values: list[float] = [50, 100, 150, 200, 300, 500, 800]
    risk_model: str = "sample"
    period: str = "1y"
    # Fixed params for non-swept values
    objective: Optional[ObjectiveConfig] = None
    constraints: Optional[ConstraintsConfig] = None


class NodeState(BaseModel):
    node_id: str
    status: NodeStatus = NodeStatus.idle
    message: str = ""
    duration_ms: Optional[int] = None


class RunEvent(BaseModel):
    seq: int
    run_id: str
    ts: str
    type: str
    node_id: Optional[str] = None
    status: Optional[str] = None
    payload: dict = {}


class TradeItem(BaseModel):
    asset_id: str
    name: str
    side: str
    shares: float
    notional: float


class LotDispositionItem(BaseModel):
    lot_id: int
    asset_id: str
    shares_sold: float
    realized_gain: float
    tax_liability: float


class RunSummary(BaseModel):
    tracking_error: float = 0.0
    turnover: float = 0.0
    estimated_tax_cost: float = 0.0
    estimated_transaction_cost: float = 0.0
    trade_count: int = 0
    converged: bool = False


class RunResult(BaseModel):
    summary: RunSummary
    trades: list[TradeItem] = []
    lot_dispositions: list[LotDispositionItem] = []
    target_weights: dict[str, float] = {}


class RunSnapshot(BaseModel):
    run_id: str
    status: RunStatus
    preset_id: str
    nodes: list[NodeState] = []
    summary: Optional[RunSummary] = None
    result: Optional[RunResult] = None
