from fastapi import APIRouter

from ..data.presets import PRESETS
from ..data.pipeline import PIPELINE_GRAPH

router = APIRouter()


@router.get("/meta")
async def meta():
    return {
        "presets": list(PRESETS.keys()),
        "risk_models": ["sample", "ewma", "shrinkage", "factor", "blend"],
        "disposal_methods": ["specific_id", "fifo", "lifo"],
        "pipeline": PIPELINE_GRAPH,
    }
