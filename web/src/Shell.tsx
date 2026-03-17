import { useState, useCallback } from 'react'
import { ActivityBar } from './components/layout/ActivityBar'
import { ExplorerPanel } from './components/explorer/ExplorerPanel'
import { ArtifactViewer } from './components/explorer/ArtifactViewer'
import App from './App'
import { BacktestView } from './views/BacktestView'
import { ExperimentsView } from './views/ExperimentsView'
import { CompareView } from './views/CompareView'
import { ReportsView } from './views/ReportsView'
import { useAppStore } from './store/useAppStore'
import './index.css'

export function Shell() {
  const [activity, setActivity] = useState('studio')
  const [studioMode, setStudioMode] = useState<'optimize' | 'backtest' | 'experiments'>('optimize')

  // Explorer state
  const [selectedFile, setSelectedFile] = useState<{ itemId: string; path: string } | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  const handleFileSelect = useCallback((itemId: string, path?: string) => {
    if (path) {
      setSelectedFile({ itemId, path })
    } else {
      // Toggle item selection for compare
      setSelectedItems((prev) => {
        const next = new Set(prev)
        if (next.has(itemId)) {
          next.delete(itemId)
        } else {
          next.add(itemId)
        }
        return next
      })
    }
  }, [])

  const handleCompareSelected = useCallback(() => {
    // Switch to compare view with selected items
    setActivity('compare')
  }, [])

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Activity Bar */}
      <ActivityBar active={activity} onChange={setActivity} />

      {/* Left Sidebar — changes by activity */}
      {activity === 'explorer' && (
        <div className="w-72 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)] shrink-0">
          <div className="flex-1 overflow-y-auto">
            <ExplorerPanel
              onItemSelect={(id, path) => handleFileSelect(id, path)}
              onFileClick={(path) => setSelectedFile({ itemId: '__file__', path })}
              selectedItems={selectedItems}
              onToggleSelect={(id) => {
                setSelectedItems((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
              onDeleteItem={(id) => {
                setSelectedItems((prev) => {
                  const next = new Set(prev)
                  next.delete(id)
                  return next
                })
              }}
            />
          </div>
          {/* Action bar */}
          {selectedItems.size > 0 && (
            <div className="p-2 border-t border-[var(--color-border)] shrink-0 flex gap-2">
              {selectedItems.size >= 2 && (
                <button
                  onClick={handleCompareSelected}
                  className="flex-1 px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-black font-medium hover:brightness-110"
                >
                  ⚖️ Compare {selectedItems.size}
                </button>
              )}
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete ${selectedItems.size} item(s)?`)) return
                  for (const id of selectedItems) {
                    await fetch(`/api/workspace/items/${id}`, { method: 'DELETE' })
                  }
                  setSelectedItems(new Set())
                  // Force explorer refresh by toggling activity
                  setActivity('studio')
                  setTimeout(() => setActivity('explorer'), 50)
                }}
                className="px-3 py-1.5 text-xs rounded border border-[var(--color-error)] text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
              >
                🗑 Delete {selectedItems.size}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Studio mode selector */}
        {activity === 'studio' && (
          <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 h-10 shrink-0">
            <div className="flex items-center gap-2 mr-4">
              <span className="text-lg font-bold text-[var(--color-accent)]">⚡</span>
              <span className="text-sm font-medium text-[var(--color-text)]">OpenVolt</span>
            </div>
            <nav className="flex items-center gap-1">
              {(['optimize', 'backtest', 'experiments'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setStudioMode(mode)}
                  className={`px-3 py-1 rounded text-xs transition-colors capitalize ${
                    studioMode === mode
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* View content */}
        <div className="flex-1 min-h-0">
          {activity === 'studio' && studioMode === 'optimize' && <App embedded />}
          {activity === 'studio' && studioMode === 'backtest' && <BacktestView embedded />}
          {activity === 'studio' && studioMode === 'experiments' && <ExperimentsView />}
          {activity === 'explorer' && (
            <ArtifactViewer
              itemId={selectedFile?.itemId || null}
              filePath={selectedFile?.path || null}
            />
          )}
          {activity === 'compare' && <CompareView selectedIds={Array.from(selectedItems)} />}
          {activity === 'reports' && <ReportsView />}
        </div>
      </div>
    </div>
  )
}
