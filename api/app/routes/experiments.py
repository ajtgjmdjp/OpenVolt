"""Experiments routes — parameter sweeps and Monte Carlo."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..schemas import SweepRequest, MonteCarloRequest, ObjectiveConfig

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
        from ..services.openvolt_service import run_optimization
        from ..data.presets import PRESETS

        preset = PRESETS.get(req.preset_id)
        if not preset:
            _results[job_id]["status"] = "failed"
            _results[job_id]["error"] = f"Unknown preset: {req.preset_id}"
            return

        loop = asyncio.get_event_loop()

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
                None, run_optimization, modified_preset, req.risk_model, "specific_id"
            )

            run_entry = {
                "index": i,
                "label": f"{req.sweep_param}={value}",
                "param_value": value,
                "summary": result["summary"],
            }
            _results[job_id]["runs"].append(run_entry)
            _results[job_id]["completed"] = i + 1

        _results[job_id]["status"] = "completed"

        # Save to workspace
        try:
            import json as _json
            from ..services.workspace.store import WorkspaceStore
            ws = WorkspaceStore("workspace")
            ws.save_item(
                id=job_id, kind="experiment",
                title=f"Sweep {req.sweep_param} ({len(req.sweep_values)} runs)",
                config={"sweep_param": req.sweep_param, "values": req.sweep_values},
                summary={"total_runs": len(req.sweep_values)},
                artifacts={"runs.json": _json.dumps(_results[job_id]["runs"], indent=2)},
            )
        except Exception:
            pass

    except Exception as e:
        _results[job_id]["status"] = "failed"
        _results[job_id]["error"] = str(e)


async def _run_montecarlo(job_id: str, req: MonteCarloRequest):
    try:
        import numpy as np
        from ..services.openvolt_service import run_optimization
        from ..data.presets import PRESETS

        preset = PRESETS.get(req.preset_id)
        if not preset:
            _results[job_id]["status"] = "failed"
            return

        loop = asyncio.get_event_loop()
        rng = np.random.default_rng(42)

        for i in range(req.n_simulations):
            modified_preset = {**preset}
            obj = dict(preset.get("objective", {}))

            # Random lambda perturbation
            obj["tracking_error"] = float(rng.uniform(*req.lambda_te_range))
            obj["tax_cost"] = float(rng.uniform(*req.lambda_tax_range))
            modified_preset["objective"] = obj

            result = await loop.run_in_executor(
                None, run_optimization, modified_preset, req.risk_model, "specific_id"
            )

            run_entry = {
                "index": i,
                "label": f"sim_{i+1}",
                "params": {
                    "lambda_te": obj["tracking_error"],
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

    except Exception as e:
        _results[job_id]["status"] = "failed"
        _results[job_id]["error"] = str(e)
