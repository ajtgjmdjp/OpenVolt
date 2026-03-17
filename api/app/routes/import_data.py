"""Import routes — CSV constituent lists, custom universes."""

from __future__ import annotations

import csv
import io
from fastapi import APIRouter, HTTPException, UploadFile, File

from ..services.workspace.store import WorkspaceStore

router = APIRouter()
_store = WorkspaceStore("workspace")


@router.post("/import/constituents")
async def import_constituents(
    name: str = "custom_universe",
    file: UploadFile = File(...),
):
    """Import a CSV file with ticker,name,weight columns as a constituent list.

    Expected CSV format:
    ticker,name,weight
    7203.T,Toyota Motor,0.05
    6758.T,Sony Group,0.04
    ...

    Weight column is optional. If absent, equal weights are used.
    """
    if not file.filename or not file.filename.endswith('.csv'):
        raise HTTPException(400, "File must be a .csv")

    content = await file.read()
    text = content.decode('utf-8-sig')  # Handle BOM

    reader = csv.DictReader(io.StringIO(text))

    tickers = {}
    for row in reader:
        ticker = row.get('ticker', row.get('symbol', row.get('Ticker', ''))).strip()
        ticker_name = row.get('name', row.get('Name', row.get('security', ticker))).strip()
        weight = row.get('weight', row.get('Weight', row.get('bench_w', ''))).strip()

        if not ticker:
            continue

        tickers[ticker] = {
            "name": ticker_name,
            "weight": float(weight) if weight else None,
        }

    if not tickers:
        raise HTTPException(400, "No valid tickers found in CSV")

    # Normalize weights if provided
    weights = [v["weight"] for v in tickers.values() if v["weight"] is not None]
    if weights:
        total = sum(weights)
        if total > 0:
            for v in tickers.values():
                if v["weight"] is not None:
                    v["weight"] = v["weight"] / total
    else:
        # Equal weight
        n = len(tickers)
        for v in tickers.values():
            v["weight"] = 1.0 / n

    # Save to workspace
    universe_data = {
        t: {"name": v["name"], "bench_w": v["weight"]}
        for t, v in tickers.items()
    }

    item_id = f"universe_{name}"
    _store.save_item(
        id=item_id,
        kind="config",
        title=f"Universe: {name} ({len(tickers)} stocks)",
        config={"type": "universe", "name": name, "count": len(tickers)},
        summary={"tickers": len(tickers)},
        artifacts={
            "universe.json": io.StringIO(
                __import__('json').dumps(universe_data, indent=2)
            ).getvalue(),
            "original.csv": text,
        },
    )

    return {
        "name": name,
        "tickers": len(tickers),
        "saved_as": item_id,
        "universe": universe_data,
    }
