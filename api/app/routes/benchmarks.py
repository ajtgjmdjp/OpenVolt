"""Benchmark routes — resolve index definitions, get weights."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


class ResolveBenchmarkRequest(BaseModel):
    index_id: Optional[str] = None
    preset_id: Optional[str] = None
    target_holdings: int = 0
    period: str = "1y"


@router.get("/benchmarks")
async def list_benchmarks():
    """List available benchmarks."""
    from ..services.benchmark_service import INDEX_SYMBOLS, WEIGHTING_SCHEMES
    from ..data.constituents import CONSTITUENTS
    from ..data.presets import PRESETS

    benchmarks = []
    for idx_id, symbol in INDEX_SYMBOLS.items():
        benchmarks.append({
            "id": idx_id,
            "symbol": symbol,
            "weighting": WEIGHTING_SCHEMES.get(idx_id, "unknown"),
            "constituents_available": len(CONSTITUENTS.get(idx_id, {})),
        })

    presets = [{"id": k, "label": v["label"]} for k, v in PRESETS.items()]

    return {"indexes": benchmarks, "presets": presets}


@router.post("/benchmarks/resolve")
async def resolve_benchmark(req: ResolveBenchmarkRequest):
    """Resolve a benchmark into tickers, weights, and optional index series."""
    try:
        from ..services.benchmark_service import resolve_benchmark
        import asyncio

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, resolve_benchmark,
            req.index_id, req.preset_id, req.target_holdings, req.period,
        )
        return result
    except Exception as e:
        raise HTTPException(400, str(e))


class IndexSeriesRequest(BaseModel):
    symbols: list[str]  # e.g. ['^N225', '^GSPC']
    period: str = "1y"


@router.post("/benchmarks/index-series")
async def get_index_series(req: IndexSeriesRequest):
    """Fetch normalized price series for one or more market indices.

    Independent of backtest execution — can be called anytime to overlay indices.
    """
    import asyncio

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _fetch_index_series, req.symbols, req.period)
    return {"indices": result}


def _fetch_index_series(symbols: list[str], period: str) -> list[dict]:
    """Fetch and normalize index price series from yfinance."""
    try:
        import yfinance as yf
    except ImportError:
        return []

    results = []
    for sym in symbols:
        try:
            data = yf.download(sym, period=period, progress=False)
            if data.empty:
                continue
            close = data["Close"]
            first = float(close.iloc[0].item() if hasattr(close.iloc[0], 'item') else close.iloc[0])
            series = []
            for i in range(len(close)):
                val = float(close.iloc[i].item() if hasattr(close.iloc[i], 'item') else close.iloc[i])
                series.append({
                    "date": str(close.index[i].date()),
                    "value": round(val / first * 100, 2),
                })
            results.append({"symbol": sym, "series": series})
        except Exception:
            pass
    return results
