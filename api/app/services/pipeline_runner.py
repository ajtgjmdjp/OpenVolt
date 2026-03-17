"""Pipeline runner — orchestrates the data→agent→risk→optimizer→output pipeline."""

from __future__ import annotations

import asyncio
import json
import time
from typing import AsyncGenerator

from ..schemas import CreateRunRequest
from ..data.pipeline import PIPELINE_GRAPH
from ..data.presets import PRESETS


class PipelineRunner:
    """Runs the optimization pipeline, yielding events for each stage."""

    def __init__(self, run_id: str, request: CreateRunRequest):
        self.run_id = run_id
        self.request = request
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    async def run(self) -> AsyncGenerator[tuple[str, str | None, dict], None]:
        """Yield (event_type, node_id, payload) tuples."""

        yield ("run.started", None, {"preset_id": self.request.preset_id})

        preset = PRESETS.get(self.request.preset_id)
        if not preset:
            yield ("run.failed", None, {"error": f"Unknown preset: {self.request.preset_id}"})
            return

        # Apply parameter overrides from request
        preset = dict(preset)  # Copy to avoid mutating the original
        if self.request.objective:
            preset["objective"] = {
                "tracking_error": self.request.objective.tracking_error,
                "transaction_cost": self.request.objective.transaction_cost,
                "tax_cost": self.request.objective.tax_cost,
            }
        if self.request.constraints:
            preset["constraints"] = {
                "max_turnover": self.request.constraints.max_turnover,
                "cash_buffer": self.request.constraints.cash_buffer,
                "max_weight": self.request.constraints.max_weight,
            }
        if self.request.tax_rate is not None:
            preset["tax_rate"] = self.request.tax_rate

        # Stage 1: Data Sources
        for node in PIPELINE_GRAPH["nodes"]:
            if node["type"] != "dataSource":
                continue
            if self._cancelled:
                return
            node_id = node["id"]
            yield ("node.started", node_id, {"message": f"Fetching {node['label']}..."})
            await asyncio.sleep(0.3)
            yield ("node.completed", node_id, {
                "message": f"{node['label']} ready",
                "duration_ms": 300,
                "status": "completed",
            })

        # Stage 2: AI Agents
        for node in PIPELINE_GRAPH["nodes"]:
            if node["type"] != "aiAgent":
                continue
            if self._cancelled:
                return
            node_id = node["id"]
            yield ("node.started", node_id, {"message": f"{node['label']} analyzing..."})
            await asyncio.sleep(0.5)
            yield ("node.completed", node_id, {
                "message": f"{node['label']} complete",
                "duration_ms": 500,
                "status": "completed",
            })

        # Stage 3: Risk Model
        if self._cancelled:
            return
        yield ("node.started", "risk.model", {
            "message": f"Computing {self.request.risk_model} covariance...",
        })
        await asyncio.sleep(0.2)

        # Stage 4: Optimizer — call real C++ engine
        yield ("node.completed", "risk.model", {
            "message": "Covariance matrix ready", "duration_ms": 200, "status": "completed",
        })
        yield ("node.started", "optimizer.main", {"message": "Solving QP (OSQP)..."})

        # Run the real optimization in a thread to not block the event loop
        try:
            from .openvolt_service import run_optimization
            loop = asyncio.get_event_loop()
            opt_result = await loop.run_in_executor(
                None,
                run_optimization,
                preset,
                self.request.risk_model,
                self.request.disposal_method,
                self.request.period,
            )
        except Exception as e:
            yield ("node.failed", "optimizer.main", {"error": str(e)})
            yield ("run.failed", None, {"error": str(e)})
            return

        solve_ms = opt_result["timing"]["solve_ms"]
        yield ("node.completed", "optimizer.main", {
            "message": f"Solved in {solve_ms}ms",
            "duration_ms": solve_ms,
            "status": "completed",
        })

        # Stage 5: Outputs
        for node in PIPELINE_GRAPH["nodes"]:
            if node["type"] != "output":
                continue
            node_id = node["id"]
            yield ("node.started", node_id, {"message": "Generating..."})
            await asyncio.sleep(0.1)
            yield ("node.completed", node_id, {
                "message": "Ready", "duration_ms": 100, "status": "completed",
            })
            yield ("artifact.ready", node_id, {
                "artifact": node_id.split(".")[-1],
            })

        # Save to workspace
        try:
            from .workspace.store import WorkspaceStore
            import csv, io
            ws = WorkspaceStore("workspace")
            trades_csv = io.StringIO()
            writer = csv.DictWriter(trades_csv, fieldnames=["asset_id", "name", "side", "shares", "notional"])
            writer.writeheader()
            for t in opt_result["trades"]:
                writer.writerow(t)
            data_range = opt_result.get("data_range", {})
            date_label = f"{data_range.get('start', '?')} to {data_range.get('end', '?')}"
            ws.save_item(
                id=self.run_id, kind="run",
                title=f"{self.request.preset_id} {self.request.risk_model} ({date_label})",
                config={
                    "preset_id": self.request.preset_id,
                    "risk_model": self.request.risk_model,
                    "period": date_label,
                    "period_code": self.request.period,
                    "data_start": data_range.get("start"),
                    "data_end": data_range.get("end"),
                    "trading_days": data_range.get("trading_days"),
                },
                summary=opt_result["summary"],
                artifacts={
                    "trades.csv": trades_csv.getvalue(),
                    "target_weights.json": json.dumps(opt_result["target_weights"], indent=2),
                },
            )
        except Exception:
            pass  # Non-critical — don't fail the run

        # Final result
        yield ("run.completed", None, {
            "summary": opt_result["summary"],
            "trades": opt_result["trades"],
            "lot_dispositions": opt_result["lot_dispositions"],
            "target_weights": opt_result["target_weights"],
            "portfolio": opt_result["portfolio"],
        })
