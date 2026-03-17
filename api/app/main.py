"""OpenVolt API — FastAPI backend wrapping the C++ optimization core."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import health, meta, runs, backtests, experiments, workspace, benchmarks

app = FastAPI(
    title="OpenVolt API",
    version="0.1.0",
    description="Professional-grade portfolio optimization engine",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(meta.router, prefix="/api")
app.include_router(runs.router, prefix="/api")
app.include_router(backtests.router, prefix="/api")
app.include_router(experiments.router, prefix="/api")
app.include_router(workspace.router, prefix="/api")
app.include_router(benchmarks.router, prefix="/api")
