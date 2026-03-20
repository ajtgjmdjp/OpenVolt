"""Backtest routes — run rolling backtests."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..schemas import CreateBacktestRequest

router = APIRouter()

# In-memory store
_results: dict = {}


@router.post("/backtests")
async def create_backtest(req: CreateBacktestRequest):
    """Start a rolling backtest with full config."""
    backtest_id = f"bt_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    asyncio.create_task(_run_backtest(backtest_id, req))
    return {"backtest_id": backtest_id, "status": "running"}


@router.get("/backtests/{backtest_id}")
async def get_backtest(backtest_id: str):
    if backtest_id not in _results:
        raise HTTPException(404, "Backtest not found")
    return _results[backtest_id]


async def _run_backtest(backtest_id: str, req: CreateBacktestRequest):
    """Run a backtest in the background."""
    try:
        from ..services.backtest_service import run_backtest_from_preset

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            run_backtest_from_preset,
            req.preset_id,
            req.risk_model,
            req.period,
            req.rebalance_frequency,
            req.objective.tracking_error if req.objective else 200.0,
            req.objective.tax_cost if req.objective else 400.0,
            req.market_indices,
            getattr(req, 'solver', 'osqp') or 'osqp',
        )

        _results[backtest_id] = {
            "backtest_id": backtest_id,
            "status": "completed",
            "result": result,
        }

        # Save to workspace
        try:
            import json
            from ..services.workspace.store import WorkspaceStore
            ws = WorkspaceStore("workspace")
            # Extract actual date range from daily data
            daily = result.get("daily", [])
            date_start = daily[0]["date"] if daily else "?"
            date_end = daily[-1]["date"] if daily else "?"
            date_label = f"{date_start} to {date_end}"

            ws.save_item(
                id=backtest_id,
                kind="backtest",
                title=f"{req.preset_id} {req.risk_model} ({date_label})",
                config={
                    "preset_id": req.preset_id,
                    "risk_model": req.risk_model,
                    "solver": getattr(req, 'solver', 'osqp') or 'osqp',
                    "period": date_label,
                    "period_code": req.period,
                    "data_start": date_start,
                    "data_end": date_end,
                    "trading_days": len(daily),
                    "rebalance_frequency": req.rebalance_frequency,
                    "lambda_te": req.objective.tracking_error if req.objective else 200,
                    "lambda_tcost": req.objective.transaction_cost if req.objective else 0,
                    "lambda_tax": req.objective.tax_cost if req.objective else 400,
                },
                summary=result.get("summary", {}),
                artifacts={
                    "daily.json": json.dumps(result.get("daily", []), indent=2),
                },
            )
        except Exception:
            pass  # Non-critical

    except Exception as e:
        _results[backtest_id] = {
            "backtest_id": backtest_id,
            "status": "failed",
            "error": str(e),
        }
