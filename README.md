# OpenVolt ⚡

AI-native portfolio optimization engine, open to everyone.

OpenVolt is a professional-grade portfolio construction platform that combines real-time data sources, AI agent analysis, and institutional-quality optimization into a single visual pipeline. Written in C++20 with Python bindings and a React-based console UI.

## What it does

```
Data Sources → AI Agents → Risk Model → Optimizer → Trades + Tax Lots
```

Given your current portfolio, benchmark weights, and a risk model, OpenVolt solves:

```
minimize   λ_te · TrackingError(w, w_benchmark)
         + λ_tcost · TransactionCost(w, w_current)
         + λ_tax · TaxCost(w, lots)

subject to  Σw = 1, 0 ≤ w ≤ cap, turnover ≤ limit
```

and returns an optimal trade list with per-lot tax dispositions.

## Features

- **C++20 optimization core** — OSQP solver with trace normalization and drift weights
- **Multiple risk models** — Sample, EWMA, Ledoit-Wolf shrinkage, statistical factor model, blend
- **Multi-objective optimization** — Tracking error + transaction cost + tax cost
- **Tax lot tracking** — FIFO, LIFO, specific identification (tax-optimal default)
- **Tax-aware rebalancing** — Short-term vs long-term capital gains, wash sale awareness
- **Python bindings** — Full C++ performance from Python with numpy support
- **React console UI** — Dark-themed pipeline visualization with React Flow
- **Real-time pipeline** — WebSocket events, node status animation, KPI dashboard
- **cvxpy parity** — Validated against cvxpy/OSQP (weight differences < 10⁻¹⁰)

## Console UI

The OpenVolt Console provides a visual pipeline view:

- **Pipeline graph** — Data sources → AI agents → Risk model → Optimizer → Output
- **Node inspector** — Click any node to see details, diagnostics, data preview
- **Result dock** — Overview (KPIs + NAV chart), Allocation, Trades, Tax Lots tabs
- **Event stream** — Real-time pipeline progress with auto-scroll

## Quick start

### Console UI (recommended)

```bash
# 1. Build C++ core
brew install eigen osqp cmake googletest
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build

# 2. Python bindings
python -m venv .venv && source .venv/bin/activate
pip install pybind11 numpy fastapi uvicorn yfinance recharts websockets
PYBIND11_DIR=$(python -c "import pybind11; print(pybind11.get_cmake_dir())")
cmake -B build -DCMAKE_BUILD_TYPE=Release -DOPENVOLT_BUILD_PYTHON=ON -Dpybind11_DIR="$PYBIND11_DIR"
cmake --build build

# 3. Frontend
cd web && npm install && cd ..

# 4. Run
uvicorn api.app.main:app --port 8000 &
cd web && npm run dev
# Open http://localhost:5173
```

### Python API

```python
import numpy as np
import _openvolt as ov

portfolio = ov.PortfolioState(
    as_of="2026-03-17",
    cash=5000.0,
    lots=[
        ov.TaxLot(1, "AAPL", 50.0, 160.0, "2025-01-15"),
        ov.TaxLot(2, "MSFT", 30.0, 400.0, "2025-06-01"),
    ],
)

risk = ov.FullCovarianceRisk(
    asset_ids=["AAPL", "MSFT", "NVDA"],
    covariance=np.array([[0.04, 0.01, 0.005], [0.01, 0.03, 0.008], [0.005, 0.008, 0.06]]),
)

market = ov.MarketData(
    as_of="2026-03-17",
    asset_ids=["AAPL", "MSFT", "NVDA"],
    prices=np.array([200.0, 450.0, 900.0]),
    benchmark_weights=np.array([0.40, 0.35, 0.25]),
    transaction_cost_bps=np.array([2.0, 2.0, 5.0]),
    risk_model=risk,
)

config = ov.OptimizationConfig()
config.taxes.disposal_method = ov.DisposalMethod.specific_id
config.taxes.short_term_rate = 0.20315  # Japan

result = ov.plan_rebalance(ov.RebalanceRequest(portfolio, market, config))

for trade in result.trades:
    print(trade)

print(f"TE: {result.diagnostics.ex_ante_tracking_error:.2%}")
```

## Architecture

```
OpenVolt/
├── api.hpp / api.cpp          # Public C++ API: plan_rebalance()
├── core/
│   ├── models/                # Position, Trade, TaxLot, Config
│   ├── risk/                  # 5 risk models
│   ├── optimizer/             # OSQP QP solver + IQPSolver interface
│   ├── portfolio/             # NAV, returns, Sharpe, drawdown
│   └── simulation/            # Backtest engine
├── workflows/                 # Strategy interface (direct indexing, etc.)
├── python/                    # pybind11 bindings
├── api/                       # FastAPI backend
├── web/                       # React + Vite + React Flow console UI
├── examples/                  # Demo scripts
└── tests/                     # 31 C++ tests + cvxpy parity tests
```

## Positioning

| Project | Focus |
|---|---|
| **OpenBB** | Data platform |
| **PyPortfolioOpt** | Textbook mean-variance |
| **QuantLib** | Derivatives pricing |
| **MiroFish** | Swarm intelligence prediction |
| **OpenVolt** | AI-native portfolio construction: data + agents + risk + optimization → trades |

## Tech stack

- **Core**: C++20, Eigen 5, OSQP 1.0
- **Python**: pybind11, FastAPI, uvicorn
- **Frontend**: React 19, Vite, React Flow, Tailwind CSS, Recharts
- **Tests**: Google Test, cvxpy parity

## License

AGPL-3.0 — see [LICENSE](LICENSE).
