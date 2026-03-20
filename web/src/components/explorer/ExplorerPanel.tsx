import { useState, useEffect } from 'react'

type TreeEntry = {
  name: string
  type: 'directory' | 'file'
  path: string
  size?: number
  children?: TreeEntry[]
}

type Props = {
  onItemSelect?: (id: string, path?: string) => void
  onFileClick?: (filePath: string) => void
  selectedItems?: Set<string>
  onToggleSelect?: (id: string) => void
  onDeleteItem?: (id: string) => void
}

export function ExplorerPanel({ onItemSelect, onFileClick, selectedItems, onToggleSelect, onDeleteItem }: Props) {
  const [tree, setTree] = useState<Record<string, TreeEntry[]>>({})
  const [items, setItems] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => setRefreshKey((k) => k + 1)

  useEffect(() => {
    Promise.all([
      fetch('/api/workspace/tree').then((r) => r.json()),
      fetch('/api/workspace/items').then((r) => r.json()),
    ]).then(([treeData, itemsData]) => {
      setTree(treeData)
      setItems(itemsData)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <div className="p-3 text-sm text-[var(--color-text-dim)]">Loading workspace...</div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Saved items */}
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
            Saved Results ({items.length})
          </h3>
          {items.length > 1 && (
            <button
              onClick={() => {
                const allIds = items.map((item) => String(item.id))
                const allSelected = allIds.every((id) => selectedItems?.has(id))
                if (allSelected) {
                  // Deselect all
                  for (const id of allIds) onToggleSelect?.(id)
                } else {
                  // Select all
                  for (const id of allIds) {
                    if (!selectedItems?.has(id)) onToggleSelect?.(id)
                  }
                }
              }}
              className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)]"
            >
              {items.every((item) => selectedItems?.has(String(item.id))) ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)]">No saved results yet. Run an optimization to get started.</p>
        ) : (
          <div className="space-y-1">
            {items.map((item) => {
              const id = String(item.id)
              const isSelected = selectedItems?.has(id) || false
              return (
                <div
                  key={id}
                  onClick={() => onToggleSelect?.(id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                    isSelected ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30' : 'hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  {/* Checkbox visual (click handled by parent div) */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="accent-[var(--color-accent)] w-3 h-3 shrink-0 pointer-events-none"
                  />
                  <span className="shrink-0">
                    {item.kind === 'run' ? '⚡' : item.kind === 'backtest' ? '📈' : item.kind === 'experiment' ? '🔬' : '📄'}
                  </span>
                  <div className="flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); onItemSelect?.(id) }}>
                    <div className="truncate text-[var(--color-text)]">{String(item.title)}</div>
                    <div className="text-[10px] text-[var(--color-text-dim)]">
                      {String(item.kind)} · {String(item.created_at).slice(0, 16)}
                    </div>
                  </div>
                  {/* Artifact links */}
                  <div className="flex gap-1 shrink-0">
                    {['config.json', 'summary.json', 'trades.csv'].map((f) => (
                      <button
                        key={f}
                        onClick={() => onItemSelect?.(id, f)}
                        className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)] px-1"
                        title={f}
                      >
                        {f.endsWith('.json') ? '{}' : '📋'}
                      </button>
                    ))}
                  </div>
                  {item.pinned === 1 && <span className="text-[var(--color-warning)]">★</span>}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (!window.confirm(`Delete "${String(item.title)}"?`)) return
                      await fetch(`/api/workspace/items/${id}`, { method: 'DELETE' })
                      // Remove from local state + refresh tree
                      setItems((prev) => prev.filter((x) => String(x.id) !== id))
                      onDeleteItem?.(id)
                      refresh()
                    }}
                    className="text-[var(--color-text-dim)] hover:text-[var(--color-error)] text-[10px] px-1 shrink-0"
                    title="Delete"
                  >🗑</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Directory tree */}
      <div className="flex-1 overflow-y-auto p-3">
        <h3 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">
          Workspace Files
        </h3>
        {Object.entries(tree).map(([category, entries]) => (
          <TreeNode key={category} name={category} entries={entries} depth={0} onFileClick={onFileClick} />
        ))}
      </div>
    </div>
  )
}

function TreeNode({ name, entries, depth, onFileClick }: { name: string; entries: TreeEntry[]; depth: number; onFileClick?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth === 0)

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full text-left py-0.5 hover:bg-[var(--color-surface-2)]/50 rounded px-1"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <span className="text-[10px] text-[var(--color-text-dim)]">{expanded ? '▾' : '▸'}</span>
        <span className="text-xs text-[var(--color-text)]">📁 {name}</span>
        {entries.length > 0 && (
          <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">{entries.length}</span>
        )}
      </button>
      {expanded && entries.map((entry) => (
        entry.type === 'directory' && entry.children ? (
          <TreeNode key={entry.path} name={entry.name} entries={entry.children} depth={depth + 1} onFileClick={onFileClick} />
        ) : (
          <div
            key={entry.path}
            onClick={() => onFileClick?.(entry.path)}
            className="flex items-center gap-1 py-0.5 text-xs text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]/50 hover:text-[var(--color-text)] rounded px-1 cursor-pointer"
            style={{ paddingLeft: (depth + 1) * 12 + 4 }}
          >
            <span className="text-[10px]">📄</span>
            <span className="truncate">{entry.name}</span>
            {entry.size !== undefined && (
              <span className="text-[10px] ml-auto">{formatSize(entry.size)}</span>
            )}
          </div>
        )
      ))}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}
