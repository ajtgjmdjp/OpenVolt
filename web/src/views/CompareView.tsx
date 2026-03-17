import { useState, useEffect } from 'react'
import { formatMoney, formatPct } from '../lib/format'

type WorkspaceItem = {
  id: string
  kind: string
  title: string
  created_at: string
  config_json: string | null
  summary_json: string | null
}

export function CompareView({ selectedIds }: { selectedIds?: string[] } = {}) {
  const [items, setItems] = useState<WorkspaceItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/workspace/items?limit=100')
      .then((r) => r.json())
      .then((data: WorkspaceItem[]) => {
        // Filter by selectedIds if provided
        if (selectedIds && selectedIds.length > 0) {
          setItems(data.filter((item) => selectedIds.includes(item.id)))
        } else {
          setItems(data)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selectedIds])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-[var(--color-accent)] animate-pulse">Loading...</span>
      </div>
    )
  }

  if (items.length < 2) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-5xl mb-4 block">⚖️</span>
          <h2 className="text-xl font-medium text-[var(--color-text)] mb-2">Compare</h2>
          <p className="text-sm text-[var(--color-text-dim)]">
            Select 2+ items from Explorer to compare
          </p>
          <p className="text-xs text-[var(--color-text-dim)] mt-2">
            {items.length} item{items.length !== 1 ? 's' : ''} selected
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h2 className="text-lg font-medium text-[var(--color-text)] mb-4">
        Comparing {items.length} Results
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm mono">
          <thead>
            <tr className="text-[var(--color-text-dim)] text-xs border-b border-[var(--color-border)]">
              <th className="text-left py-2">Title</th>
              <th className="text-left">Kind</th>
              <th className="text-right">TE</th>
              <th className="text-right">Turnover</th>
              <th className="text-right">Tax Cost</th>
              <th className="text-right">Trades</th>
              <th className="text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const summary = item.summary_json ? JSON.parse(item.summary_json) : {}
              const config = item.config_json ? JSON.parse(item.config_json) : {}
              return (
                <tr key={item.id} className="border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-2)]/50">
                  <td className="py-1.5 text-[var(--color-text)]">{item.title}</td>
                  <td className="text-[var(--color-text-dim)]">{item.kind}</td>
                  <td className="text-right">
                    {summary.tracking_error ? formatPct(summary.tracking_error) : '—'}
                  </td>
                  <td className="text-right">
                    {summary.turnover ? formatPct(summary.turnover) : '—'}
                  </td>
                  <td className="text-right">
                    {summary.estimated_tax_cost ? formatMoney(summary.estimated_tax_cost) : '—'}
                  </td>
                  <td className="text-right">
                    {summary.trade_count != null ? String(summary.trade_count) : '—'}
                  </td>
                  <td className="text-[var(--color-text-dim)] text-xs">
                    {config.period || item.created_at?.slice(0, 10) || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
