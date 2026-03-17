"""Report generation routes."""

from __future__ import annotations

import asyncio
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


class GenerateReportRequest(BaseModel):
    artifact_ids: list[str]
    prompt: str = ""
    model: str = "gemini-2.0-flash"


@router.post("/reports/generate")
async def generate_report(req: GenerateReportRequest):
    """Generate an AI-powered investment report from workspace artifacts."""
    from ..services.report_service import generate_report as _generate

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, _generate, req.artifact_ids, req.prompt, req.model,
    )
    return result
