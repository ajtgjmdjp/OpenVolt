import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { formatPct } from '../lib/format'
import { COMMON_INDICES, filterIndices } from '../lib/commonIndices'
import { ConfigPanel, DEFAULT_CONFIG } from '../components/config/ConfigPanel'
import type { OptimizeConfig } from '../components/config/ConfigPanel'

const COMPARE_COLORS = ['#00d4ff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#6366f1']

// Metrics with fallback keys: try primary key first, then alt
const RESULT_METRICS: { key: string; alt?: string; label: string; fmt: (v: number) => string }[] = [
  { key: 'annualized_return', label: 'Return', fmt: formatPct },
  { key: 'annualized_benchmark_return', label: 'Benchmark Return', fmt: formatPct },
  { key: 'annualized_volatility', label: 'Volatility', fmt: formatPct },
  { key: 'annualized_tracking_error', alt: 'tracking_error', label: 'Tracking Error', fmt: formatPct },
  { key: 'sharpe_ratio', label: 'Sharpe', fmt: (v: number) => v.toFixed(2) },
  { key: 'information_ratio', label: 'Info Ratio', fmt: (v: number) => v.toFixed(2) },
  { key: 'max_drawdown', label: 'Max Drawdown', fmt: formatPct },
  { key: 'turnover', label: 'Turnover', fmt: formatPct },
  { key: 'estimated_tax_cost', label: 'Tax Cost', fmt: (v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(Math.round(v)) },
  { key: 'trade_count', alt: 'total_rebalances', label: 'Trades', fmt: (v: number) => String(Math.round(v)) },
]

function getMetricValue(summary: Record<string, unknown>, key: string, alt?: string): number | null {
  let v = summary[key]
  if ((v === undefined || v === null) && alt) v = summary[alt]
  return typeof v === 'number' ? v : null
}

const CONFIG_KEYS = [
  { key: 'preset_id', label: 'Preset' },
  { key: 'risk_model', label: 'Risk Model' },
  { key: 'rebalance_frequency', label: 'Rebalance' },
  { key: 'period', label: 'Period' },
  { key: 'period_code', label: 'Period Code' },
  { key: 'trading_days', label: 'Trading Days' },
]

const HIGHER_IS_BETTER = new Set(['annualized_return', 'sharpe_ratio', 'information_ratio', 'max_drawdown'])
const LOWER_IS_BETTER = new Set(['annualized_volatility', 'annualized_tracking_error'])

type WsItem = {
  id: string
  kind: string
  title: string
  created_at: string
  config_json: string | null
  summary_json: string | null
}

export function CompareView({ selectedIds }: { selectedIds?: string[] } = {}) {
  const [items, setItems] = useState<WsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showNewRun, setShowNewRun] = useState(false)
  const [runConfig, setRunConfig] = useState<OptimizeConfig>({ ...DEFAULT_CONFIG })
  const [runStatus, setRunStatus] = useState<'idle' | 'running'>('idle')
  const [promotingRuns, setPromotingRuns] = useState(false)

  const refreshItems = useCallback(() => {
    fetch('/api/workspace/items?limit=100')
      .then((r) => r.json())
      .then((data: WsItem[]) => {
        setItems(data)
        // Auto-select newly added item
        if (data.length > items.length) {
          const newItem = data[data.length - 1]
          if (newItem) setSelected((prev) => new Set(prev).add(newItem.id))
        }
      })
      .catch(() => {})
  }, [items.length])

  const handleRunBacktest = useCallback(async () => {
    setRunStatus('running')
    try {
      const res = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset_id: runConfig.preset_id,
          risk_model: runConfig.risk_model,
          period: runConfig.period,
          rebalance_frequency: runConfig.rebalance_frequency,
          objective: {
            tracking_error: runConfig.lambda_te,
            transaction_cost: runConfig.lambda_tcost,
            tax_cost: runConfig.lambda_tax,
          },
        }),
      })
      const { backtest_id } = await res.json()
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await fetch(`/api/backtests/${backtest_id}`)
        const data = await poll.json()
        if (data.status === 'completed' || data.status === 'failed') break
      }
      refreshItems()
      setShowNewRun(false)
    } catch { /* ignore */ }
    setRunStatus('idle')
  }, [runConfig, refreshItems])

  // Placeholder — will be defined after comparedItems
  const promoteRunsRef = { current: async () => {} }

  useEffect(() => {
    setLoading(true)
    fetch('/api/workspace/items?limit=100')
      .then((r) => r.json())
      .then((data: WsItem[]) => {
        setItems(data)
        if (selectedIds && selectedIds.length > 0) {
          setSelected(new Set(selectedIds))
        } else if (data.length >= 2) {
          // Auto-select last 2 non-experiment items
          const selectable = data.filter((d) => d.kind !== 'experiment')
          setSelected(new Set(selectable.slice(-2).map((d) => d.id)))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selectedIds?.join(',')])

  // Expanded experiments and their loaded runs
  const [expandedExps, setExpandedExps] = useState<Set<string>>(new Set())
  const [expRuns, setExpRuns] = useState<Map<string, Array<Record<string, unknown>>>>(new Map())

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleExpand = async (id: string) => {
    const next = new Set(expandedExps)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
      // Load runs.json if not already loaded
      if (!expRuns.has(id)) {
        try {
          const res = await fetch(`/api/workspace/items/${id}/artifacts/runs.json`)
          if (res.ok) {
            const resp = await res.json()
            const data = typeof resp.content === 'string' ? JSON.parse(resp.content) : resp.content
            if (Array.isArray(data)) setExpRuns((prev) => new Map(prev).set(id, data))
          }
        } catch { /* ignore */ }
      }
    }
    setExpandedExps(next)
  }

  // Build compared items: workspace items + expanded experiment runs
  type CompareItem = { id: string; title: string; kind: string; summary: Record<string, unknown>; config?: Record<string, unknown>; parentId?: string }

  const comparedItems: CompareItem[] = []
  for (const id of selected) {
    // Check if it's an experiment run (format: expId:runIndex)
    if (id.includes(':run_')) {
      const [expId, runPart] = id.split(':run_')
      const runIdx = parseInt(runPart)
      const runs = expRuns.get(expId)
      if (runs && runs[runIdx]) {
        const run = runs[runIdx]
        // Merge parent experiment config with run-specific params
        const parentItem = items.find((i) => i.id === expId)
        const parentConfig = parentItem?.config_json
          ? (typeof parentItem.config_json === 'string' ? JSON.parse(parentItem.config_json) : parentItem.config_json)
          : {}
        // Use run.config (complete) if available, else merge parent + params
        const runConfig = (run.config || { ...parentConfig, ...(run.params || {}) }) as Record<string, unknown>
        comparedItems.push({
          id,
          title: String(run.label || `Run ${runIdx}`),
          kind: 'run',
          summary: (run.summary || run) as Record<string, unknown>,
          config: runConfig,
          parentId: expId,
        })
      }
    } else {
      const item = items.find((i) => i.id === id)
      if (item && item.kind !== 'experiment') {
        comparedItems.push({
          id: item.id,
          title: item.title,
          kind: item.kind,
          summary: item.summary_json ? (typeof item.summary_json === 'string' ? JSON.parse(item.summary_json) : item.summary_json) : {},
          config: item.config_json ? (typeof item.config_json === 'string' ? JSON.parse(item.config_json) : item.config_json) : {},
        })
      }
    }
  }

  // Promote experiment runs to full backtests
  const promoteRunsToBacktest = async () => {
    const runItems = comparedItems.filter((ci) => ci.kind === 'run')
    if (runItems.length === 0) return
    setPromotingRuns(true)
    const newIds: string[] = []
    for (const run of runItems) {
      const cfg = run.config || {}
      // Use period_code from parent experiment, fall back to config.period
      const period = cfg.period_code || cfg.period || runConfig.period
      try {
        const res = await fetch('/api/backtests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preset_id: cfg.preset_id || runConfig.preset_id,
            risk_model: cfg.risk_model || runConfig.risk_model,
            period: period,
            rebalance_frequency: cfg.rebalance_frequency || runConfig.rebalance_frequency,
            objective: {
              tracking_error: cfg.lambda_te ?? cfg.tracking_error ?? runConfig.lambda_te,
              transaction_cost: cfg.lambda_tcost ?? cfg.transaction_cost ?? 0,
              tax_cost: cfg.lambda_tax ?? cfg.tax_cost ?? runConfig.lambda_tax,
            },
          }),
        })
        const { backtest_id } = await res.json()
        newIds.push(backtest_id)
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          const poll = await fetch(`/api/backtests/${backtest_id}`)
          const data = await poll.json()
          if (data.status === 'completed' || data.status === 'failed') break
        }
      } catch { /* ignore */ }
    }
    // Deselect experiment runs, select new backtests
    setSelected((prev) => {
      const next = new Set(prev)
      for (const ci of runItems) next.delete(ci.id)
      for (const id of newIds) next.add(id)
      return next
    })
    refreshItems()
    setPromotingRuns(false)
  }
  promoteRunsRef.current = promoteRunsToBacktest

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-[var(--color-accent)] animate-pulse">Loading...</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-5xl mb-4 block">⚖️</span>
          <h2 className="text-xl font-medium text-[var(--color-text)] mb-2">Compare</h2>
          <p className="text-sm text-[var(--color-text-dim)]">Run backtests to compare. Results are saved automatically.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left: item picker + new run */}
      <div className="w-64 border-r border-[var(--color-border)] overflow-y-auto shrink-0 bg-[var(--color-surface)]">
        {/* New backtest inline */}
        <div className="p-2 border-b border-[var(--color-border)]">
          <button
            onClick={() => setShowNewRun(!showNewRun)}
            className={`w-full px-3 py-1.5 text-xs rounded font-medium transition-all ${
              showNewRun
                ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                : 'bg-[var(--color-accent)] text-black hover:brightness-110'
            }`}
          >
            {runStatus === 'running' ? '⏳ Running...' : showNewRun ? '▾ Close Config' : '+ New Backtest'}
          </button>
          {showNewRun && (
            <div className="mt-2 max-h-[50vh] overflow-y-auto">
              <ConfigPanel config={runConfig} onChange={setRunConfig} />
              <div className="p-3 pt-1">
                <button onClick={handleRunBacktest} disabled={runStatus === 'running'}
                  className="w-full px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-black font-medium hover:brightness-110 disabled:opacity-50">
                  {runStatus === 'running' ? '⏳ Running...' : '▶ Run & Add to Compare'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
            Results ({items.length})
          </div>
          {items.length > 1 && (
            <button onClick={() => {
              const selectable = items.filter((i) => i.kind !== 'experiment')
              const allSel = selectable.every((i) => selected.has(i.id))
              if (allSel) setSelected(new Set())
              else setSelected(new Set(selectable.map((i) => i.id)))
            }} className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)]">
              {items.every((i) => selected.has(i.id)) ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        <div className="space-y-0.5">
          {items.map((item) => {
            const isExp = item.kind === 'experiment'
            const isExpanded = expandedExps.has(item.id)
            const runs = expRuns.get(item.id) || []
            const icon = isExp ? '🔬' : item.kind === 'run' ? '⚡' : '📈'

            return (
              <div key={item.id}>
                <div onClick={() => isExp ? toggleExpand(item.id) : toggleSelect(item.id)}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                  !isExp && selected.has(item.id)
                    ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30'
                    : 'hover:bg-[var(--color-surface-2)]'
                }`}>
                  {isExp && (
                    <span className="text-[10px] text-[var(--color-text-dim)] mt-0.5 shrink-0 w-3">
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  )}
                  {!isExp && (
                    <input type="checkbox" checked={selected.has(item.id)} readOnly
                      className="w-3 h-3 mt-0.5 shrink-0 pointer-events-none accent-[var(--color-accent)]" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[var(--color-text)]">{icon} {item.title}</div>
                    <div className="text-[10px] text-[var(--color-text-dim)]">
                      {item.kind} · {item.created_at?.slice(0, 16)}
                    </div>
                  </div>
                </div>
                {/* Expanded experiment runs */}
                {isExp && isExpanded && (
                  <div className="ml-5 space-y-0.5 mt-0.5">
                    {runs.length === 0 && (
                      <div className="text-[10px] text-[var(--color-text-dim)] px-2 py-1">Loading runs...</div>
                    )}
                    {runs.map((run, ri) => {
                      const runId = `${item.id}:run_${ri}`
                      const isRunSelected = selected.has(runId)
                      return (
                        <div key={ri} onClick={() => toggleSelect(runId)}
                          className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                            isRunSelected
                              ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30'
                              : 'hover:bg-[var(--color-surface-2)]'
                          }`}>
                          <input type="checkbox" checked={isRunSelected} readOnly
                            className="w-3 h-3 shrink-0 pointer-events-none accent-[var(--color-accent)]" />
                          <span className="truncate text-[var(--color-text-dim)]">
                            {String(run.label || `Run ${ri}`)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>{/* end p-3 */}
      </div>{/* end left panel */}

      {/* Right: comparison */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {comparedItems.length < 1 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-[var(--color-text-dim)]">Select a result to view, or 2+ to compare</p>
          </div>
        ) : (
          <>
            {/* NAV chart — for items with daily data (backtests) */}
            {(() => {
              const btItems = comparedItems.filter((ci) => ci.kind === 'backtest')
              const runOnly = btItems.length === 0
              return btItems.length >= 1 ? (
                <div>
                  <NavChart items={items.filter((i) => btItems.some((bi) => bi.id === i.id))} />
                  {comparedItems.length > btItems.length && (
                    <div className="text-[10px] text-[var(--color-text-dim)] mt-1">NAV chart: backtests only. Experiment runs show metrics below.</div>
                  )}
                </div>
              ) : runOnly ? (
                <div className="bg-[var(--color-surface-2)] rounded p-3 flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    Experiment runs have no NAV data. Run full backtests to get NAV charts.
                  </span>
                  <button
                    onClick={() => promoteRunsRef.current()}
                    disabled={promotingRuns}
                    className="px-3 py-1 text-[10px] rounded bg-[var(--color-accent)] text-black font-medium hover:brightness-110 disabled:opacity-50 shrink-0 ml-3"
                  >
                    {promotingRuns ? '⏳ Running...' : `▶ Run ${comparedItems.filter(ci => ci.kind === 'run').length} as Backtest`}
                  </button>
                </div>
              ) : null
            })()}

            {/* Unified comparison table: header row + config + results in one table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs mono" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '140px' }} />
                  {comparedItems.map((ci) => (
                    <col key={ci.id} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
                    <th className="text-left py-2"></th>
                    {comparedItems.map((ci, i) => (
                      <th key={ci.id} className="text-center py-2 px-1" style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>
                        <div className="truncate text-[11px]">
                          {ci.kind === 'run' ? '⚡' : '📈'} {ci.title}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* --- Configuration section --- */}
                  {(() => {
                    const allConfigs = comparedItems.map((ci) => ci.config || {})
                    const allKeys = new Set<string>()
                    for (const cfg of allConfigs) for (const k of Object.keys(cfg)) allKeys.add(k)
                    const sortedKeys = Array.from(allKeys).sort()
                    if (sortedKeys.length === 0) return null
                    return (
                      <>
                        <tr><td colSpan={comparedItems.length + 1} className="pt-3 pb-1 text-[10px] text-[var(--color-accent)] uppercase tracking-wider font-medium">Configuration</td></tr>
                        {sortedKeys.map((key) => {
                          const values = allConfigs.map((cfg) => {
                            const v = cfg[key]
                            return v !== undefined && v !== null ? String(v) : '—'
                          })
                          const allSame = values.every((v) => v === values[0])
                          return (
                            <tr key={`cfg_${key}`} className={`border-b border-[var(--color-border)]/20 ${allSame ? 'opacity-40' : ''}`}>
                              <td className="py-1 text-[var(--color-text-dim)]">{key.replace(/_/g, ' ')}</td>
                              {values.map((v, i) => (
                                <td key={i} className={`text-center px-1 ${!allSame ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text)]'}`}>{v}</td>
                              ))}
                            </tr>
                          )
                        })}
                      </>
                    )
                  })()}

                  {/* --- Results section --- */}
                  <tr><td colSpan={comparedItems.length + 1} className="pt-3 pb-1 text-[10px] text-[var(--color-accent)] uppercase tracking-wider font-medium">Results</td></tr>
                  {RESULT_METRICS.map((metric) => {
                    const values = comparedItems.map((ci) => getMetricValue(ci.summary, metric.key, metric.alt))
                    const nums = values.filter((v): v is number => v !== null)
                    let bestVal: number | null = null
                    if (nums.length > 1) {
                      if (HIGHER_IS_BETTER.has(metric.key)) bestVal = Math.max(...nums)
                      else if (LOWER_IS_BETTER.has(metric.key)) bestVal = Math.min(...nums)
                    }
                    return (
                      <tr key={metric.key} className="border-b border-[var(--color-border)]/20">
                        <td className="py-1 text-[var(--color-text-dim)]">{metric.label}</td>
                        {values.map((v, i) => (
                          <td key={i} className={`text-center px-1 ${v !== null && v === bestVal ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text)]'}`}>
                            {v !== null ? metric.fmt(v) : '—'}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// --- NAV Chart (fetches daily.json from workspace) ---
function NavChart({ items }: { items: WsItem[] }) {
  const [dailyData, setDailyData] = useState<Map<string, Array<Record<string, unknown>>>>(new Map())
  const [indexOverlays, setIndexOverlays] = useState<Array<{ symbol: string; series: Array<{ date: string; value: number }> }>>([])
  const [showPicker, setShowPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [fetching, setFetching] = useState<string | null>(null)

  const itemIds = items.map((i) => i.id).join(',')
  useEffect(() => {
    const fetchAll = async () => {
      const newMap = new Map<string, Array<Record<string, unknown>>>()
      for (const item of items) {
        try {
          const res = await fetch(`/api/workspace/items/${item.id}/artifacts/daily.json`)
          if (res.ok) {
            const resp = await res.json()
            // API returns { content: "..." } where content is a JSON string
            const data = typeof resp.content === 'string' ? JSON.parse(resp.content) : resp.content
            if (Array.isArray(data)) newMap.set(item.id, data)
          }
        } catch { /* ignore */ }
      }
      setDailyData(newMap)
    }
    fetchAll()
  }, [itemIds])

  const fetchIndex = async (symbol: string) => {
    if (indexOverlays.some((o) => o.symbol === symbol)) return
    setFetching(symbol)
    try {
      const res = await fetch('/api/benchmarks/index-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [symbol], period: '3y' }),
      })
      const data = await res.json()
      if (data.indices?.length) {
        setIndexOverlays((prev) => [...prev, ...data.indices])
        setShowPicker(false)
        setQuery('')
      }
    } catch { /* ignore */ }
    setFetching(null)
  }

  // Build chart data
  const allDates = new Set<string>()
  const navMaps = items.map((item) => {
    const daily = dailyData.get(item.id) || []
    const firstNav = (daily[0]?.nav as number) || 1
    const map = new Map<string, number>()
    for (const d of daily) {
      const date = d.date as string
      allDates.add(date)
      map.set(date, ((d.nav as number) / firstNav) * 100)
    }
    return map
  })

  const idxMaps = indexOverlays.map((io) => {
    const map = new Map(io.series.map((p) => [p.date, p.value]))
    for (const d of map.keys()) allDates.add(d)
    return { symbol: io.symbol, map }
  })

  const sortedDates = Array.from(allDates).sort()
  const chartData = sortedDates.map((date) => {
    const row: Record<string, unknown> = { date }
    items.forEach((_, i) => { row[`r_${i}`] = navMaps[i].get(date) ?? null })
    idxMaps.forEach((im) => { row[`idx_${im.symbol}`] = im.map.get(date) ?? null })
    return row
  })

  const hasData = dailyData.size > 0

  return (
    <div>
      <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
        NAV Comparison {!hasData && '(loading...)'}
      </div>
      {hasData && (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%" debounce={100}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
              <XAxis dataKey="date" tick={{ fill: '#8888a0', fontSize: 10 }}
                interval={Math.max(1, Math.floor(chartData.length / 10))}
                tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fill: '#8888a0', fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                formatter={(value: unknown, name: unknown) => {
                  const n = String(name)
                  if (n.startsWith('r_')) {
                    const idx = Number(n.replace('r_', ''))
                    return [`${Number(value).toFixed(1)}`, items[idx]?.title?.slice(0, 30) || n]
                  }
                  return [`${Number(value).toFixed(1)}`, n]
                }} />
              {items.map((_, i) => (
                <Line key={i} type="monotone" dataKey={`r_${i}`}
                  stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                  strokeWidth={0.9} dot={false} connectNulls name={`r_${i}`} />
              ))}
              {idxMaps.map((im, i) => (
                <Line key={im.symbol} type="monotone" dataKey={`idx_${im.symbol}`}
                  stroke={['#ef4444', '#8b5cf6', '#ec4899'][i % 3]}
                  strokeWidth={0.7} dot={false} strokeDasharray="2 2"
                  connectNulls name={`Market: ${im.symbol}`} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {/* Legend + index picker */}
      <div className="flex flex-wrap gap-3 mt-1 items-center">
        {items.map((item, i) => (
          <span key={item.id} className="flex items-center gap-1 text-[10px]">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
            <span className="text-[var(--color-text-dim)]">{item.title.slice(0, 35)}</span>
          </span>
        ))}
        {indexOverlays.map((io, i) => (
          <span key={io.symbol} className="flex items-center gap-1 text-[10px]">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: ['#ef4444', '#8b5cf6', '#ec4899'][i % 3] }} />
            <span className="text-[var(--color-text-dim)]">
              {COMMON_INDICES.find((c) => c.symbol === io.symbol)?.label || io.symbol}
            </span>
            <button onClick={() => setIndexOverlays((prev) => prev.filter((o) => o.symbol !== io.symbol))}
              className="text-[var(--color-text-dim)] hover:text-[var(--color-error)]">×</button>
          </span>
        ))}
        <div className="relative">
          <button onClick={() => setShowPicker(!showPicker)}
            className="px-1.5 py-0.5 text-[10px] rounded border border-dashed border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]">
            + Index
          </button>
          {showPicker && (
            <div className="absolute bottom-6 left-0 z-50 w-52 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl p-2 space-y-1">
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) fetchIndex(query.trim().toUpperCase()); if (e.key === 'Escape') setShowPicker(false) }}
                placeholder="Search or symbol..."
                className="w-full px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none mono" />
              <div className="max-h-36 overflow-y-auto space-y-0.5">
                {filterIndices(query).map((idx) => {
                  const loaded = indexOverlays.some((o) => o.symbol === idx.symbol)
                  return (
                    <button key={idx.symbol} onClick={() => !loaded && fetchIndex(idx.symbol)}
                      disabled={loaded} className={`w-full text-left px-2 py-1 text-xs rounded flex justify-between ${loaded ? 'opacity-50' : 'hover:bg-[var(--color-surface-2)]'}`}>
                      <span>{loaded ? '✓ ' : fetching === idx.symbol ? '⏳ ' : ''}{idx.label}</span>
                      <span className="mono text-[10px] text-[var(--color-text-dim)]">{idx.symbol}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Config Diff (used by workspace compare) ---
export function ConfigDiff({ items }: { items: WsItem[] }) {
  const configs = items.map((item) => {
    try { return item.config_json ? JSON.parse(item.config_json) : {} } catch { return {} }
  })

  return (
    <div>
      <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Configuration</div>
      <table className="w-full text-xs mono">
        <thead>
          <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
            <th className="text-left py-1.5">Parameter</th>
            {items.map((item, i) => (
              <th key={item.id} className="text-right py-1.5 px-2" style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>
                {item.title.slice(0, 20)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONFIG_KEYS.map(({ key, label }) => {
            const values = configs.map((c) => c[key] !== undefined ? String(c[key]) : '—')
            const allSame = values.every((v) => v === values[0])
            return (
              <tr key={key} className={`border-b border-[var(--color-border)]/30 ${allSame ? 'opacity-40' : ''}`}>
                <td className="py-1 text-[var(--color-text-dim)]">{label}</td>
                {values.map((v, i) => (
                  <td key={i} className={`text-right px-2 ${!allSame ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text)]'}`}>{v}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- Results Table (used by workspace compare) ---
export function ResultsTable({ items }: { items: WsItem[] }) {
  const summaries = items.map((item) => {
    try { return item.summary_json ? JSON.parse(item.summary_json) : {} } catch { return {} }
  })

  return (
    <div>
      <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider mb-1">Results</div>
      <table className="w-full text-xs mono">
        <thead>
          <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
            <th className="text-left py-1.5">Metric</th>
            {items.map((item, i) => (
              <th key={item.id} className="text-right py-1.5 px-2" style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>
                {item.title.slice(0, 20)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RESULT_METRICS.map((metric) => {
            const values = summaries.map((s) => {
              const v = s[metric.key]
              return typeof v === 'number' ? v : null
            })
            const nums = values.filter((v): v is number => v !== null)
            let bestVal: number | null = null
            if (nums.length > 0) {
              if (HIGHER_IS_BETTER.has(metric.key)) bestVal = Math.max(...nums)
              else if (LOWER_IS_BETTER.has(metric.key)) bestVal = Math.min(...nums)
            }
            return (
              <tr key={metric.key} className="border-b border-[var(--color-border)]/30">
                <td className="py-1 text-[var(--color-text-dim)]">{metric.label}</td>
                {values.map((v, i) => (
                  <td key={i} className={`text-right px-2 ${v !== null && v === bestVal ? 'text-[var(--color-accent)] font-medium' : 'text-[var(--color-text)]'}`}>
                    {v !== null ? metric.fmt(v) : '—'}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
