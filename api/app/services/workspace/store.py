"""Workspace store — SQLite metadata + filesystem artifacts."""

from __future__ import annotations

import contextlib
import json
import shutil
import sqlite3
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path


class WorkspaceStore:
    """Manages workspace directory, SQLite index, and artifact persistence."""

    def __init__(self, workspace_dir: str = "workspace"):
        self.root = Path(workspace_dir).resolve()
        self.db_path = self.root / ".openvolt" / "workspace.db"

        # Create directory structure
        for d in ["input/prices", "input/benchmarks", "input/constituents", "input/custom",
                   "configs/optimize", "configs/backtest", "configs/experiments", "configs/universes",
                   "runs", "backtests", "experiments", "reports", ".openvolt/cache"]:
            (self.root / d).mkdir(parents=True, exist_ok=True)

        # Initialize SQLite
        self._init_db()

    def _init_db(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,  -- 'run', 'backtest', 'experiment', 'config', 'dataset', 'report'
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                config_json TEXT,
                summary_json TEXT,
                tags TEXT DEFAULT '',
                pinned INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                artifact_dir TEXT  -- relative path from workspace root
            );
            CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
            CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
        """)
        conn.close()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    @contextlib.contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """Yield a SQLite connection, guaranteed to be closed on exit.

        Always preferred over manual `_conn()`+`close()` because any
        exception between the two would leak the connection (and on
        Windows, lock the database).
        """
        conn = self._conn()
        try:
            yield conn
        finally:
            conn.close()

    # -----------------------------------------------------------------------
    # CRUD
    # -----------------------------------------------------------------------

    _VALID_KINDS = {"run", "backtest", "experiment", "config", "report"}

    @staticmethod
    def _sanitize(name: str) -> str:
        """Reject path separators and traversal patterns."""
        if ".." in name or "/" in name or "\\" in name:
            raise ValueError(f"Invalid path component: {name}")
        return name

    def save_item(self, id: str, kind: str, title: str,
                  config: dict | None = None,
                  summary: dict | None = None,
                  artifacts: dict[str, str | bytes] | None = None,
                  tags: list[str] | None = None) -> dict:
        """Save a workspace item with optional artifacts."""
        self._sanitize(id)
        if kind not in self._VALID_KINDS:
            raise ValueError(f"Invalid kind: {kind}")
        now = datetime.now(timezone.utc).isoformat()

        # Determine artifact directory
        kind_dir = {"run": "runs", "backtest": "backtests", "experiment": "experiments",
                    "config": "configs", "report": "reports"}[kind]
        artifact_dir = f"{kind_dir}/{id}"
        full_dir = self.root / artifact_dir
        full_dir.mkdir(parents=True, exist_ok=True)

        # Save config and summary as JSON files
        if config:
            (full_dir / "config.json").write_text(json.dumps(config, indent=2))
        if summary:
            (full_dir / "summary.json").write_text(json.dumps(summary, indent=2))

        # Save additional artifacts
        if artifacts:
            for name, content in artifacts.items():
                self._sanitize(name)
                path = full_dir / name
                if isinstance(content, bytes):
                    path.write_bytes(content)
                else:
                    path.write_text(content)

        # Save manifest. Only list artifacts that were actually written so
        # consumers don't 404 on optional config/summary files.
        manifest_artifacts = list((artifacts or {}).keys())
        if config:
            manifest_artifacts.append("config.json")
        if summary:
            manifest_artifacts.append("summary.json")
        manifest = {
            "id": id, "kind": kind, "title": title,
            "created_at": now, "artifact_dir": artifact_dir,
            "artifacts": manifest_artifacts,
        }
        (full_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

        # Upsert in SQLite
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO items (id, kind, title, created_at, updated_at,
                    config_json, summary_json, tags, artifact_dir)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    id, kind, title, now, now,
                    json.dumps(config) if config else None,
                    json.dumps(summary) if summary else None,
                    ",".join(tags or []),
                    artifact_dir,
                ),
            )
            conn.commit()

        return manifest

    def list_items(self, kind: str | None = None, limit: int = 50,
                   search: str | None = None) -> list[dict]:
        """List workspace items, optionally filtered."""
        query = "SELECT * FROM items"
        params: list = []
        conditions = []

        if kind:
            conditions.append("kind = ?")
            params.append(kind)
        if search:
            conditions.append("(title LIKE ? OR tags LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])

        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def get_item(self, id: str) -> dict | None:
        """Get a single workspace item by ID."""
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM items WHERE id = ?", (id,)).fetchone()
        return dict(row) if row else None

    def get_artifact(self, id: str, artifact_name: str) -> str | None:
        """Read an artifact file."""
        item = self.get_item(id)
        if not item or not item.get("artifact_dir"):
            return None
        path = self.root / item["artifact_dir"] / artifact_name
        # Security: prevent path traversal
        try:
            path.resolve().relative_to((self.root / item["artifact_dir"]).resolve())
        except ValueError:
            return None
        if path.exists():
            return path.read_text()
        return None

    def delete_item(self, id: str) -> bool:
        """Delete a workspace item and its artifacts."""
        item = self.get_item(id)
        if not item:
            return False

        # Delete artifact directory
        if item.get("artifact_dir"):
            full_dir = self.root / item["artifact_dir"]
            if full_dir.exists():
                shutil.rmtree(full_dir)

        with self._connect() as conn:
            conn.execute("DELETE FROM items WHERE id = ?", (id,))
            conn.commit()
        return True

    def update_item(self, id: str, title: str | None = None,
                    tags: list[str] | None = None,
                    pinned: bool | None = None,
                    notes: str | None = None) -> bool:
        """Update metadata of a workspace item."""
        updates = []
        params: list = []
        now = datetime.now(timezone.utc).isoformat()

        if title is not None:
            updates.append("title = ?")
            params.append(title)
        if tags is not None:
            updates.append("tags = ?")
            params.append(",".join(tags))
        if pinned is not None:
            updates.append("pinned = ?")
            params.append(1 if pinned else 0)
        if notes is not None:
            updates.append("notes = ?")
            params.append(notes)

        if not updates:
            return False  # Nothing requested — caller probably has a bug.

        updates.append("updated_at = ?")
        params.append(now)
        params.append(id)

        with self._connect() as conn:
            conn.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
        return True

    # -----------------------------------------------------------------------
    # Workspace tree
    # -----------------------------------------------------------------------

    def get_tree(self) -> dict:
        """Get workspace directory tree for the Explorer sidebar."""
        tree = {}
        for category in ["input", "configs", "runs", "backtests", "experiments", "reports"]:
            cat_path = self.root / category
            if cat_path.exists():
                tree[category] = self._scan_dir(cat_path, depth=2)
        return tree

    def _scan_dir(self, path: Path, depth: int) -> list[dict]:
        entries = []
        if depth <= 0:
            return entries
        try:
            for item in sorted(path.iterdir()):
                if item.name.startswith("."):
                    continue
                entry = {
                    "name": item.name,
                    "type": "directory" if item.is_dir() else "file",
                    "path": str(item.relative_to(self.root)),
                }
                if item.is_dir() and depth > 1:
                    entry["children"] = self._scan_dir(item, depth - 1)
                if item.is_file():
                    entry["size"] = item.stat().st_size
                entries.append(entry)
        except PermissionError:
            pass
        return entries
