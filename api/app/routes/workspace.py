"""Workspace routes — browse, save, load workspace artifacts."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..services.workspace.store import WorkspaceStore

router = APIRouter()

# Global workspace instance
_store = WorkspaceStore("workspace")


class SaveItemRequest(BaseModel):
    id: str
    kind: str
    title: str
    config: Optional[dict] = None
    summary: Optional[dict] = None
    artifacts: Optional[dict[str, str]] = None
    tags: Optional[list[str]] = None


class UpdateItemRequest(BaseModel):
    title: Optional[str] = None
    tags: Optional[list[str]] = None
    pinned: Optional[bool] = None
    notes: Optional[str] = None


@router.get("/workspace/tree")
async def get_tree():
    """Get workspace directory tree for Explorer sidebar."""
    return _store.get_tree()


@router.get("/workspace/items")
async def list_items(kind: Optional[str] = None, search: Optional[str] = None,
                     limit: int = 50):
    """List workspace items."""
    return _store.list_items(kind=kind, search=search, limit=limit)


@router.get("/workspace/items/{item_id}")
async def get_item(item_id: str):
    """Get a single workspace item."""
    item = _store.get_item(item_id)
    if not item:
        raise HTTPException(404, f"Item {item_id} not found")
    return item


@router.get("/workspace/items/{item_id}/artifacts/{artifact_name:path}")
async def get_artifact(item_id: str, artifact_name: str):
    """Read an artifact file."""
    content = _store.get_artifact(item_id, artifact_name)
    if content is None:
        raise HTTPException(404, f"Artifact {artifact_name} not found")
    return {"content": content}


@router.get("/workspace/file/{file_path:path}")
async def read_file(file_path: str):
    """Read any file from the workspace directory by relative path."""
    full = _store.root / file_path
    if not full.exists():
        raise HTTPException(404, f"File not found: {file_path}")
    if not full.is_file():
        raise HTTPException(400, f"Not a file: {file_path}")
    # Security: ensure path stays within workspace
    try:
        full.resolve().relative_to(_store.root.resolve())
    except ValueError:
        raise HTTPException(403, "Access denied")
    return {"content": full.read_text(errors='replace'), "path": file_path, "size": full.stat().st_size}


@router.post("/workspace/items")
async def save_item(req: SaveItemRequest):
    """Save a workspace item."""
    manifest = _store.save_item(
        id=req.id, kind=req.kind, title=req.title,
        config=req.config, summary=req.summary,
        artifacts=req.artifacts, tags=req.tags,
    )
    return manifest


@router.patch("/workspace/items/{item_id}")
async def update_item(item_id: str, req: UpdateItemRequest):
    """Update workspace item metadata."""
    ok = _store.update_item(
        item_id, title=req.title, tags=req.tags,
        pinned=req.pinned, notes=req.notes,
    )
    if not ok:
        raise HTTPException(404, f"Item {item_id} not found")
    return {"status": "updated"}


@router.delete("/workspace/items/{item_id}")
async def delete_item(item_id: str):
    """Delete a workspace item and its artifacts."""
    ok = _store.delete_item(item_id)
    if not ok:
        raise HTTPException(404, f"Item {item_id} not found")
    return {"status": "deleted"}
