"""Experiments routes — parameter sweeps and Monte Carlo."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..schemas import SweepRequest, MonteCarloRequest, ObjectiveConfig

logger = logging.getLogger(__name__)

router = APIRouter()

_results: dict = {}


@router.post("/experiments/sweep")
async def create_sweep(req: SweepRequest):
    job_id = f"sweep_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    _results[job_id] = {"status": "running", "runs": [], "total": len(req.sweep_values)}
    asyncio.create_task(_run_sweep(job_id, req))
    return {"job_id": job_id, "status": "running", "total": len(req.sweep_values)}


@router.post("/experiments/montecarlo")
async def create_montecarlo(req: MonteCarloRequest):
    job_id = f"mc_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    _results[job_id] = {"status": "running", "runs": [], "total": req.n_simulations}
    asyncio.create_task(_run_montecarlo(job_id, req))
    return {"job_id": job_id, "status": "running", "total": req.n_simulations}


@router.get("/experiments/{job_id}")
async def get_experiment(job_id: str):
    if job_id not in _results:
        raise HTTPException(404, "Experiment not found")
    return _results[job_id]


async def _run_sweep(job_id: str, req: SweepRequest):
    try:
        from ..services.openvolt_service import run_optimization, prefetch_market_data
        from ..data.presets import PRESETS

        preset = PRESETS.get(req.preset_id)
        if not preset:
            _results[job_id]["status"] = "failed"
            _results[job_id]["error"] = f"Unknown preset: {req.preset_id}"
            return

        loop = asyncio.get_event_loop()

        # Pre-fetch market data once for all sweep points
        cached_data = await loop.run_in_executor(None, prefetch_market_data, preset, "1y")

        for i, value in enumerate(req.sweep_values):
            # Override the swept parameter in the preset
            modified_preset = {**preset}
            obj = dict(preset.get("objective", {}))

            if req.sweep_param == "lambda_te":
                obj["tracking_error"] = value
            elif req.sweep_param == "lambda_tax":
                obj["tax_cost"] = value
            elif req.sweep_param == "lambda_tcost":
                obj["transaction_cost"] = value

            modified_preset["objective"] = obj

            # Apply fixed overrides
            if req.objective:
                if req.sweep_param != "lambda_te" and req.objective.tracking_error:
                    obj["tracking_error"] = req.objective.tracking_error
                if req.sweep_param != "lambda_tax" and req.objective.tax_cost:
                    obj["tax_cost"] = req.objective.tax_cost

            result = await loop.run_in_executor(
                None, run_optimization, modified_preset, req.risk_model, "specific_id", "1y", cached_data
            )

            # Build full config for this run (everything needed to reproduce as backtest)
            base_obj = req.objective.model_dump() if req.objective else {}
            run_config = {
                "preset_id": req.preset_id,
                "risk_model": req.risk_model,
                "period": req.period,
                "rebalance_frequency": req.rebalance_frequency,
                "lambda_te": obj.get("tracking_error", base_obj.get("tracking_error", 200)),
                "lambda_tcost": obj.get("transaction_cost", base_obj.get("transaction_cost", 0)),
                "lambda_tax": obj.get("tax_cost", base_obj.get("tax_cost", 400)),
            }

            run_entry = {
                "index": i,
                "label": f"{req.sweep_param}={value}",
                "param_value": value,
                "summary": result["summary"],
                "config": run_config,
            }
            _results[job_id]["runs"].append(run_entry)
            _results[job_id]["completed"] = i + 1

        _results[job_id]["status"] = "completed"

        # Save to workspace with full reproducible config
        try:
            import json as _json
            from ..services.workspace.store import WorkspaceStore
            ws = WorkspaceStore("workspace")

            base_obj_dict = req.objective.model_dump() if req.objective else {}
            full_config = {
                "mode": "sweep",
                "sweep_param": req.sweep_param,
                "values": req.sweep_values,
                "preset_id": req.preset_id,
                "risk_model": req.risk_model,
                "period": req.period,
                "rebalance_frequency": req.rebalance_frequency,
                "lambda_te": base_obj_dict.get("tracking_error", 200),
                "lambda_tcost": base_obj_dict.get("transaction_cost", 0),
                "lambda_tax": base_obj_dict.get("tax_cost", 400),
            }

            ws.save_item(
                id=job_id, kind="experiment",
                title=f"Sweep {req.sweep_param} ({len(req.sweep_values)} runs, {req.preset_id})",
                config=full_config,
                summary={"total_runs": len(req.sweep_values)},
                artifacts={"runs.json": _json.dumps(_results[job_id]["runs"], indent=2)},
            )
        except Exception:
            logger.exception("Failed to persist sweep %s to workspace", job_id)

    except Exception as e:
        logger.exception("Sweep %s failed", job_id)
        _results[job_id]["status"] = "failed"
        _results[job_id]["error"] = str(e)


async def _run_montecarlo(job_id: str, req: MonteCarloRequest):
    try:
        import numpy as np
        from ..services.openvolt_service import run_optimization, prefetch_market_data
        from ..data.presets import PRESETS

        preset = PRESETS.get(req.preset_id)
        if not preset:
            _results[job_id]["status"] = "failed"
            return

        loop = asyncio.get_event_loop()
        rng = np.random.default_rng(42)

        # Pre-fetch market data once
        cached_data = await loop.run_in_executor(None, prefetch_market_data, preset, "1y")

        for i in range(req.n_simulations):
            modified_preset = {**preset}
            obj = dict(preset.get("objective", {}))

            # Random lambda perturbation
            obj["tracking_error"] = float(rng.uniform(*req.lambda_te_range))
            obj["tax_cost"] = float(rng.uniform(*req.lambda_tax_range))
            modified_preset["objective"] = obj

            result = await loop.run_in_executor(
                None, run_optimization, modified_preset, req.risk_model, "specific_id", "1y", cached_data
            )

            run_entry = {
                "index": i,
                "label": f"sim_{i+1}",
                "params": {
                    "lambda_te": obj["tracking_error"],
                    "lambda_tax": obj["tax_cost"],
                },
                "config": {
                    "preset_id": req.preset_id,
                    "risk_model": req.risk_model,
                    "period": req.period,
                    "rebalance_frequency": req.rebalance_frequency,
                    "lambda_te": obj["tracking_error"],
                    "lambda_tcost": 0,
                    "lambda_tax": obj["tax_cost"],
                },
                "summary": result["summary"],
            }
            _results[job_id]["runs"].append(run_entry)
            _results[job_id]["completed"] = i + 1

        # Compute aggregate statistics
        summaries = [r["summary"] for r in _results[job_id]["runs"]]
        te_values = [s["tracking_error"] for s in summaries]
        tax_values = [s["estimated_tax_cost"] for s in summaries]
        turnover_values = [s["turnover"] for s in summaries]

        _results[job_id]["aggregate"] = {
            "tracking_error": {
                "mean": float(np.mean(te_values)),
                "std": float(np.std(te_values)),
                "p5": float(np.percentile(te_values, 5)),
                "p50": float(np.percentile(te_values, 50)),
                "p95": float(np.percentile(te_values, 95)),
            },
            "estimated_tax_cost": {
                "mean": float(np.mean(tax_values)),
                "std": float(np.std(tax_values)),
                "p5": float(np.percentile(tax_values, 5)),
                "p50": float(np.percentile(tax_values, 50)),
                "p95": float(np.percentile(tax_values, 95)),
            },
            "turnover": {
                "mean": float(np.mean(turnover_values)),
                "std": float(np.std(turnover_values)),
            },
        }

        _results[job_id]["status"] = "completed"

        # Save to workspace
        try:
            import json as _json
            from ..services.workspace.store import WorkspaceStore
            ws = WorkspaceStore("workspace")
            ws.save_item(
                id=job_id, kind="experiment",
                title=f"Monte Carlo ({req.n_simulations} sims, {req.preset_id})",
                config={"mode": "montecarlo", "n_simulations": req.n_simulations,
                         "preset_id": req.preset_id, "risk_model": req.risk_model,
                         "period": req.period, "rebalance_frequency": req.rebalance_frequency,
                         "lambda_te_range": req.lambda_te_range,
                         "lambda_tax_range": req.lambda_tax_range},
                summary={"total_runs": req.n_simulations,
                          **{k: v for k, v in _results[job_id].get("aggregate", {}).items()}},
                artifacts={
                    "runs.json": _json.dumps(_results[job_id]["runs"], indent=2),
                    "aggregate.json": _json.dumps(_results[job_id].get("aggregate", {}), indent=2),
                },
            )
        except Exception:
            logger.exception("Failed to persist Monte Carlo %s to workspace", job_id)

    except Exception as e:
        logger.exception("Monte Carlo %s failed", job_id)
        _results[job_id]["status"] = "failed"
        _results[job_id]["error"] = str(e)
