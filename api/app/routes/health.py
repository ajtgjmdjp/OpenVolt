from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "engine": "openvolt", "version": "0.1.0"}
