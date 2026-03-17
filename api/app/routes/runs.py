"""Run management routes."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..schemas import (
    CreateRunRequest,
    NodeState,
    NodeStatus,
    RunEvent,
    RunSnapshot,
    RunStatus,
)
from ..services.pipeline_runner import PipelineRunner

router = APIRouter()

# In-memory run store (MVP — no persistence)
_runs: dict[str, RunSnapshot] = {}
_runners: dict[str, PipelineRunner] = {}
_subscribers: dict[str, list[WebSocket]] = {}


@router.post("/runs")
async def create_run(req: CreateRunRequest):
    run_id = f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    snapshot = RunSnapshot(
        run_id=run_id,
        status=RunStatus.pending,
        preset_id=req.preset_id,
    )
    _runs[run_id] = snapshot

    runner = PipelineRunner(run_id, req)
    _runners[run_id] = runner

    # Start pipeline in background
    asyncio.create_task(_execute_run(run_id, runner))

    return {"run_id": run_id, "status": "pending"}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    if run_id not in _runs:
        raise HTTPException(404, f"Run {run_id} not found")
    return _runs[run_id]


@router.get("/runs/{run_id}/result")
async def get_result(run_id: str):
    if run_id not in _runs:
        raise HTTPException(404, f"Run {run_id} not found")
    snap = _runs[run_id]
    if snap.status != RunStatus.completed:
        raise HTTPException(400, f"Run is {snap.status}, not completed")
    return snap.result


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    if run_id not in _runners:
        raise HTTPException(404, f"Run {run_id} not found")
    _runners[run_id].cancel()
    _runs[run_id].status = RunStatus.cancelled
    return {"run_id": run_id, "status": "cancelled"}


@router.websocket("/ws/runs/{run_id}")
async def ws_run(websocket: WebSocket, run_id: str):
    await websocket.accept()

    if run_id not in _subscribers:
        _subscribers[run_id] = []
    _subscribers[run_id].append(websocket)

    # Send current snapshot
    if run_id in _runs:
        await websocket.send_json(
            RunEvent(
                seq=0, run_id=run_id,
                ts=datetime.now(timezone.utc).isoformat(),
                type="run.snapshot",
                payload=_runs[run_id].model_dump(),
            ).model_dump()
        )

    try:
        while True:
            await websocket.receive_text()  # Keep alive
    except WebSocketDisconnect:
        _subscribers[run_id].remove(websocket)


async def _broadcast(run_id: str, event: RunEvent):
    """Send event to all WebSocket subscribers."""
    if run_id not in _subscribers:
        return
    dead = []
    for ws in _subscribers[run_id]:
        try:
            await ws.send_json(event.model_dump())
        except Exception:
            dead.append(ws)
    for ws in dead:
        _subscribers[run_id].remove(ws)


async def _execute_run(run_id: str, runner: PipelineRunner):
    """Execute pipeline and broadcast events."""
    snap = _runs[run_id]
    snap.status = RunStatus.running
    seq = 1

    async for event_type, node_id, payload in runner.run():
        ts = datetime.now(timezone.utc).isoformat()
        event = RunEvent(
            seq=seq, run_id=run_id, ts=ts,
            type=event_type, node_id=node_id,
            status=payload.get("status"),
            payload=payload,
        )
        seq += 1

        # Update snapshot
        if event_type == "node.started":
            _update_node(snap, node_id, NodeStatus.running, payload.get("message", ""))
        elif event_type == "node.completed":
            _update_node(snap, node_id, NodeStatus.completed, payload.get("message", ""),
                         payload.get("duration_ms"))
        elif event_type == "node.failed":
            _update_node(snap, node_id, NodeStatus.failed, payload.get("error", ""))
        elif event_type == "run.completed":
            snap.status = RunStatus.completed
            snap.summary = payload.get("summary")
            snap.result = payload.get("result")
        elif event_type == "run.failed":
            snap.status = RunStatus.failed

        await _broadcast(run_id, event)

    if snap.status == RunStatus.running:
        snap.status = RunStatus.completed


def _update_node(snap: RunSnapshot, node_id: str, status: NodeStatus,
                 message: str = "", duration_ms: int | None = None):
    for node in snap.nodes:
        if node.node_id == node_id:
            node.status = status
            node.message = message
            node.duration_ms = duration_ms
            return
    snap.nodes.append(NodeState(
        node_id=node_id, status=status, message=message, duration_ms=duration_ms
    ))
