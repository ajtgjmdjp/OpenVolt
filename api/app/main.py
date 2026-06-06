"""OpenVolt API — FastAPI backend wrapping the C++ optimization core."""

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import health, meta, runs, backtests, experiments, workspace, benchmarks, import_data, reports

# Configure root logger once at import time. Uvicorn installs its own
# handlers for access/error logs; this one captures application code
# (services/, routes/) that uses `logging.getLogger(__name__)`.
logging.basicConfig(
    level=os.environ.get("OPENVOLT_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

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
app.include_router(import_data.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
