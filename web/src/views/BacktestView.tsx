import { useState, useCallback, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts'
import { formatMoney, formatPct } from '../lib/format'
import { COMMON_INDICES, filterIndices } from '../lib/commonIndices'
import { ConfigPanel } from '../components/config/ConfigPanel'
import { useAppStore } from '../store/useAppStore'

type DailySnap = {
  date: string
  nav: number
  benchmark_nav: number
  after_tax_nav: number
  portfolio_return: number
  benchmark_return: number
  rolling_te: number
  rebalanced: boolean
  trade_count: number
  cumulative_tax_paid: number
  cumulative_realized_gain: number
}

type IndexPoint = { date: string; value: number }

const INDEX_COLORS = ['#ef4444', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#6366f1']

type MarketIndexData = {
  symbol: string
  series: IndexPoint[]
}

type BacktestResult = {
  summary: Record<string, unknown>
  daily: DailySnap[]
  index_series?: IndexPoint[]
  index_symbol?: string
  market_indices?: MarketIndexData[]
} | null

function RebalanceTable({ events, defaultExpanded, onHoverDate }: {
  events: DailySnap[]
  defaultExpanded: boolean
  onHoverDate: (date: string | null) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="shrink-0 px-3 pb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-[var(--color-text-dim)] uppercase tracking-wider mb-1 hover:text-[var(--color-text)]"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Rebalance Events ({events.length})</span>
      </button>
      {expanded && (
        <div className="max-h-36 overflow-y-auto">
          <table className="w-full text-xs mono">
            <thead>
              <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Date</th>
                <th className="text-right">NAV</th>
                <th className="text-right">Target BM NAV</th>
                <th className="text-right">Active Ret</th>
                <th className="text-right">Rolling TE</th>
                <th className="text-right">Trades</th>
              </tr>
            </thead>
            <tbody>
              {events.map((d, i) => (
                <tr key={i}
                  className="border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-2)] cursor-default"
                  onMouseEnter={() => onHoverDate(d.date)}
                  onMouseLeave={() => onHoverDate(null)}
                >
                  <td className="py-1">{d.date}</td>
                  <td className="text-right">{formatMoney(d.nav)}</td>
                  <td className="text-right">{formatMoney(d.benchmark_nav)}</td>
                  <td className={`text-right ${(d.portfolio_return - d.benchmark_return) >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                    {formatPct(d.portfolio_return - d.benchmark_return)}
                  </td>
                  <td className="text-right">{formatPct(d.rolling_te)}</td>
                  <td className="text-right">{d.trade_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface-2)] rounded-lg p-3 flex flex-col items-center overflow-hidden">
      <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider truncate w-full text-center">{label}</span>
      <span className="text-lg font-bold mono text-[var(--color-text)] mt-1 truncate w-full text-center">{value}</span>
    </div>
  )
}

export function BacktestView(_props: { embedded?: boolean }) {
  // Zustand — persisted across view switches
  const btResult = useAppStore((s) => s.backtestResult)
  const btStatus = useAppStore((s) => s.backtestStatus)
  const btError = useAppStore((s) => s.backtestError)
  const config = useAppStore((s) => s.backtestConfig)
  const setBacktestState = useAppStore((s) => s.setBacktestState)
  const setConfig = (c: typeof config) => setBacktestState({ backtestConfig: c })
  const saveBacktest = useAppStore((s) => s.saveBacktest)
  const visibleCharts = useAppStore((s) => s.visibleCharts)
  const toggleChart = useAppStore((s) => s.toggleChart)

  const result = btResult as BacktestResult | null
  const status = btStatus as 'idle' | 'running' | 'completed' | 'failed'
  const error = btError

  const setResult = (r: BacktestResult | null) => setBacktestState({ backtestResult: r as BacktestResult & Record<string, unknown> | null })
  const setStatus = (s: string) => setBacktestState({ backtestStatus: s })
  const setError = (e: string | null) => setBacktestState({ backtestError: e })

  const [showConfig, setShowConfig] = useState(false)
  const [activeRebalanceDate, setActiveRebalanceDate] = useState<string | null>(null)
  // Main chart line toggles — market indices enabled when fetched
  const [mainLines, setMainLines] = useState<Record<string, boolean>>({
    afterTax: true,
    benchmark: true,
  })
  const toggleMainLine = (key: string) => setMainLines((prev) => ({ ...prev, [key]: !prev[key] }))

  // Independent index overlay state (fetched separately from backtest)
  const [overlayIndices, setOverlayIndices] = useState<MarketIndexData[]>([])
  const [showIndexPicker, setShowIndexPicker] = useState(false)
  const [indexQuery, setIndexQuery] = useState('')
  const [indexFetchError, setIndexFetchError] = useState<string | null>(null)
  const [indexFetching, setIndexFetching] = useState<string | null>(null) // symbol being fetched

  const fetchOverlayIndex = useCallback(async (symbol: string) => {
    if (overlayIndices.some((o) => o.symbol === symbol)) return
    setIndexFetchError(null)
    setIndexFetching(symbol)
    try {
      const res = await fetch('/api/benchmarks/index-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: [symbol], period: config.period }),
      })
      const data = await res.json()
      if (data.indices?.length) {
        setOverlayIndices((prev) => [...prev, ...data.indices])
        for (const idx of data.indices) {
          setMainLines((prev) => ({ ...prev, [`idx_${idx.symbol}`]: true }))
        }
        setShowIndexPicker(false)
        setIndexQuery('')
      } else {
        setIndexFetchError(`No data for "${symbol}" in period ${config.period}`)
      }
    } catch (e) {
      setIndexFetchError(`Network error: ${e instanceof Error ? e.message : 'failed to fetch'}`)
    } finally {
      setIndexFetching(null)
    }
  }, [overlayIndices, config.period])

  const removeOverlayIndex = useCallback((symbol: string) => {
    setOverlayIndices((prev) => prev.filter((o) => o.symbol !== symbol))
    setMainLines((prev) => {
      const next = { ...prev }
      delete next[`idx_${symbol}`]
      return next
    })
  }, [])

  // Auto-fetch configured indices on backtest completion
  // Clear stale overlays and re-fetch with the backtest's actual period
  useEffect(() => {
    if (status !== 'completed') return
    // Clear old overlays (period may have changed)
    setOverlayIndices([])
    const configured = config.market_indices || []
    const fromResult = result?.market_indices?.map((m) => m.symbol) || []
    const allSymbols = [...new Set([...configured, ...fromResult])]

    // Fetch with current period
    const fetchAll = async () => {
      for (const sym of allSymbols) {
        try {
          const res = await fetch('/api/benchmarks/index-series', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: [sym], period: config.period }),
          })
          const data = await res.json()
          if (data.indices?.length) {
            setOverlayIndices((prev) => [...prev, ...data.indices])
            for (const idx of data.indices) {
              setMainLines((prev) => ({ ...prev, [`idx_${idx.symbol}`]: true }))
            }
          }
        } catch { /* ignore */ }
      }
    }
    fetchAll()
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = useCallback(async () => {
    setStatus('running')
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset_id: config.preset_id,
          risk_model: config.risk_model,
          solver: config.solver || 'osqp',
          period: config.period,
          rebalance_frequency: config.rebalance_frequency,
          market_indices: config.market_indices?.length ? config.market_indices : undefined,
          objective: {
            tracking_error: config.lambda_te,
            transaction_cost: config.lambda_tcost,
            tax_cost: config.lambda_tax,
          },
        }),
      })
      const { backtest_id } = await res.json()

      // Poll for result
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await fetch(`/api/backtests/${backtest_id}`)
        const data = await poll.json()

        if (data.status === 'completed') {
          setResult(data.result)
          setStatus('completed')
          // Save for cross-view reuse
          saveBacktest({
            id: backtest_id,
            label: `${config.preset_id} · ${config.rebalance_frequency} · λTE ${config.lambda_te} · λTax ${config.lambda_tax}`,
            config: { ...config },
            result: data.result,
          })
          return
        } else if (data.status === 'failed') {
          setError(data.error || 'Backtest failed')
          setStatus('failed')
          return
        }
      }
      setError('Timeout')
      setStatus('failed')
    } catch (e) {
      setError(String(e))
      setStatus('failed')
    }
  }, [config])

  const s = result?.summary
  const daily = result?.daily || []

  // Find rebalance dates for markers


  // Build index lookups from independent overlay state
  const indexMaps = overlayIndices.map((mi) => ({
    symbol: mi.symbol,
    map: new Map(mi.series.map((p) => [p.date, p.value])),
  }))

  // Build unified date set: backtest dates + all overlay dates
  const dailyMap = new Map(daily.map((d) => [d.date, d]))
  const allDates = new Set(daily.map((d) => d.date))
  for (const im of indexMaps) {
    for (const date of im.map.keys()) allDates.add(date)
  }
  const sortedDates = Array.from(allDates).sort()

  // Chart data: normalize NAV to 100 + compute drawdown
  let peak = 100
  const chartData = sortedDates.map((date) => {
    const d = dailyMap.get(date)
    const portfolio = d?.nav ? (d.nav / (daily[0]?.nav || 1)) * 100 : null
    if (portfolio !== null) peak = Math.max(peak, portfolio)
    const drawdown = portfolio !== null ? ((peak - portfolio) / peak) * -100 : null

    const indexValues: Record<string, number | null> = {}
    for (const im of indexMaps) {
      indexValues[`idx_${im.symbol}`] = im.map.get(date) ?? null
    }

    const afterTax = d?.after_tax_nav ? (d.after_tax_nav / (daily[0]?.after_tax_nav || daily[0]?.nav || 1)) * 100 : null

    return {
      date,
      fullDate: date,
      portfolio,
      afterTax,
      benchmark: d?.benchmark_nav ? (d.benchmark_nav / (daily[0]?.benchmark_nav || 1)) * 100 : null,
      ...indexValues,
      te: d ? d.rolling_te * 100 : null,
      drawdown,
      rebalanced: d?.rebalanced ?? false,
      trades: d?.trade_count ?? 0,
    }
  })

  // Cumulative realized P&L (from daily returns, approximate)
  let cumPnl = 0
  const cumulativePnlData = daily.map((d) => {
    // Use portfolio vs benchmark as proxy for net P&L
    const dailyPnl = d.nav && daily[0]?.nav
      ? (d.portfolio_return - d.benchmark_return) * daily[0].nav
      : 0
    cumPnl += dailyPnl
    return { date: d.date, cumPnl: Math.round(cumPnl) }
  })

  // Annual P&L breakdown
  const annualMap = new Map<string, number>()
  for (const d of daily) {
    const year = d.date.slice(0, 4)
    const dailyPnl = d.nav && daily[0]?.nav
      ? (d.portfolio_return - d.benchmark_return) * daily[0].nav
      : 0
    annualMap.set(year, (annualMap.get(year) || 0) + dailyPnl)
  }
  const annualPnlData = Array.from(annualMap, ([year, pnl]) => ({ year, pnl: Math.round(pnl) }))

  // Rebalance events for table
  const rebalanceEvents = daily.filter((d) => d.rebalanced)

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-dim)] mono">
            {config.risk_model} · {config.period} · {config.rebalance_frequency}
          </span>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${
              showConfig
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
            }`}
          >
            ⚙ Settings
          </button>
        </div>
        <button
          onClick={handleRun}
          disabled={status === 'running'}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-all ${
            status === 'running'
              ? 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] cursor-not-allowed'
              : 'bg-[var(--color-accent)] text-black hover:brightness-110 cursor-pointer'
          }`}
        >
          {status === 'running' ? 'Running...' : '▶ Run Backtest'}
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Config sidebar */}
        {showConfig && (
          <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto overflow-x-hidden shrink-0 bg-[var(--color-surface)]">
            <ConfigPanel config={config} onChange={setConfig} />
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">

      {status === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="text-5xl mb-4 block">📈</span>
            <h2 className="text-xl font-medium text-[var(--color-text)] mb-2">Rolling Backtest</h2>
            <p className="text-sm text-[var(--color-text-dim)] mb-4">
              Simulate periodic rebalancing with tax-aware optimization
            </p>
            <button
              onClick={handleRun}
              className="px-6 py-2 rounded bg-[var(--color-accent)] text-black font-medium hover:brightness-110 cursor-pointer"
            >
              ▶ Run Backtest
            </button>
          </div>
        </div>
      )}

      {status === 'running' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="text-4xl mb-4 block animate-pulse">⚡</span>
            <p className="text-[var(--color-accent)]">Running rolling backtest...</p>
            <p className="text-sm text-[var(--color-text-dim)] mt-2">Fetching data and optimizing weekly rebalances</p>
          </div>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="text-4xl mb-4 block">❌</span>
            <p className="text-[var(--color-error)]">Backtest failed</p>
            <p className="text-sm text-[var(--color-text-dim)] mt-2">{error}</p>
          </div>
        </div>
      )}

      {status === 'completed' && s && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* KPI Strip */}
          <div className="grid grid-cols-8 gap-2 p-3 shrink-0">
            <KPI label="Return" value={formatPct(s.annualized_return as number)} />
            <KPI label="Target Benchmark" value={formatPct(s.annualized_benchmark_return as number)} />
            <KPI label="Volatility" value={formatPct(s.annualized_volatility as number)} />
            <KPI label="Tracking Error" value={formatPct(s.annualized_tracking_error as number)} />
            <KPI label="Sharpe" value={(s.sharpe_ratio as number).toFixed(2)} />
            <KPI label="Info Ratio" value={(s.information_ratio as number).toFixed(2)} />
            <KPI label="Max DD" value={formatPct(s.max_drawdown as number)} />
            <KPI label="Rebalances" value={String(s.total_rebalances)} />
          </div>

          {/* Main chart: NAV */}
          <div className="flex-[60] min-h-0 px-3 flex flex-col">
            {/* Line toggles */}
            <div className="flex gap-3 mb-1 shrink-0 items-center">
              <span className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Series:</span>
              {/* Portfolio always on — shown as label only */}
              <span className="text-[10px]" style={{ color: '#64748b' }}>● Pre-Tax</span>
              {([
                { key: 'afterTax', label: 'After-Tax', color: '#22c55e' },
                { key: 'benchmark', label: 'Target BM', color: '#f59e0b' },
                ...indexMaps.map((im, i) => ({
                  key: `idx_${im.symbol}`,
                  label: im.symbol,
                  color: INDEX_COLORS[i % INDEX_COLORS.length],
                })),
              ]).map((line) => (
                <label key={line.key} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mainLines[line.key] === true}
                    onChange={() => toggleMainLine(line.key)}
                    className="w-3 h-3"
                    style={{ accentColor: line.color }}
                  />
                  <span className={`text-[10px] ${mainLines[line.key] === true ? '' : 'opacity-40'}`} style={{ color: line.color }}>
                    {line.label}
                  </span>
                </label>
              ))}
              {/* Overlay chips + add button */}
              {overlayIndices.length > 0 && <span className="text-[var(--color-border)]">|</span>}
              {overlayIndices.map((oi, i) => (
                <span key={oi.symbol} className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-surface-2)]">
                  <span style={{ color: INDEX_COLORS[i % INDEX_COLORS.length] }}>
                    {COMMON_INDICES.find((c) => c.symbol === oi.symbol)?.label || oi.symbol}
                  </span>
                  <button onClick={() => removeOverlayIndex(oi.symbol)}
                    className="text-[var(--color-text-dim)] hover:text-[var(--color-error)] ml-0.5">×</button>
                </span>
              ))}
              <div className="relative">
                <button onClick={() => setShowIndexPicker(!showIndexPicker)}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-dashed border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]">
                  + Index
                </button>
                {showIndexPicker && (
                  <div className="absolute top-6 left-0 z-50 w-56 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl p-2 space-y-1.5">
                    <input
                      autoFocus
                      value={indexQuery}
                      onChange={(e) => { setIndexQuery(e.target.value); setIndexFetchError(null) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && indexQuery.trim()) {
                          fetchOverlayIndex(indexQuery.trim().toUpperCase())
                        }
                        if (e.key === 'Escape') setShowIndexPicker(false)
                      }}
                      placeholder="Search or enter symbol..."
                      className="w-full px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none mono"
                    />
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {filterIndices(indexQuery).map((idx) => {
                        const loaded = overlayIndices.some((o) => o.symbol === idx.symbol)
                        const loading = indexFetching === idx.symbol
                        return (
                          <button key={idx.symbol}
                            onClick={() => !loaded && !loading && fetchOverlayIndex(idx.symbol)}
                            disabled={loaded || loading}
                            className={`w-full text-left px-2 py-1 text-xs rounded flex justify-between items-center ${
                              loaded ? 'text-[var(--color-text-dim)] opacity-50'
                                : loading ? 'text-[var(--color-accent)] opacity-70'
                                : 'text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
                            }`}>
                            <span>{loading ? '⏳ ' : loaded ? '✓ ' : ''}{idx.label}</span>
                            <span className="mono text-[10px] text-[var(--color-text-dim)]">{idx.symbol}</span>
                          </button>
                        )
                      })}
                    </div>
                    {indexFetching && (
                      <div className="flex items-center gap-1.5 px-1 py-1">
                        <span className="text-[10px] animate-pulse text-[var(--color-accent)]">●</span>
                        <span className="text-[10px] text-[var(--color-text-dim)]">Fetching {indexFetching}...</span>
                      </div>
                    )}
                    {indexFetchError && (
                      <div className="text-[10px] text-[var(--color-error)] px-1">{indexFetchError}</div>
                    )}
                    {indexQuery.trim() && !COMMON_INDICES.some((c) => c.symbol === indexQuery.trim().toUpperCase()) && (
                      <button
                        onClick={() => fetchOverlayIndex(indexQuery.trim().toUpperCase())}
                        className="w-full text-left px-2 py-1 text-xs rounded text-[var(--color-accent)] hover:bg-[var(--color-surface-2)]">
                        Fetch "{indexQuery.trim().toUpperCase()}" from yfinance
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <ResponsiveContainer width="100%" height="100%" debounce={100}>
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#8888a0', fontSize: 10 }}
                  interval={Math.max(1, Math.floor(chartData.length / 12))}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis
                  tick={{ fill: '#8888a0', fontSize: 10 }}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: '#8888a0' }}
                  itemSorter={(item) => {
                    // Market(0) → Target(1) → After-Tax(2) → Pre-Tax(3)
                    const order: Record<string, number> = { benchmark: 1, afterTax: 2, portfolio: 3 }
                    const name = String(item.dataKey || '')
                    if (name.startsWith('idx_')) return 0
                    return order[name] ?? 99
                  }}
                  formatter={(value: unknown, name: unknown) => [
                    `${Number(value).toFixed(1)}`,
                    name === 'portfolio' ? 'Portfolio (Pre-Tax)'
                      : name === 'afterTax' ? 'After-Tax NAV'
                      : name === 'benchmark' ? 'Target Benchmark'
                      : String(name)
                  ]}
                />
                {/* Render order: back to front (market → benchmark → afterTax → portfolio) */}
                {/* Back to front: portfolio (bottom) → market → benchmark → afterTax (top) */}
                <Line type="monotone" dataKey="portfolio" stroke="#64748b" strokeWidth={0.8} dot={false} name="portfolio" />
                {indexMaps.map((im, i) => mainLines[`idx_${im.symbol}`] === true && (
                  <Line key={im.symbol} type="monotone" dataKey={`idx_${im.symbol}`}
                    stroke={INDEX_COLORS[i % INDEX_COLORS.length]} strokeWidth={0.7} dot={false}
                    strokeDasharray="2 2" name={`Market: ${im.symbol}`} connectNulls />
                ))}
                {mainLines.benchmark === true && (
                  <Line type="monotone" dataKey="benchmark" stroke="#f59e0b" strokeWidth={0.9} dot={false} strokeDasharray="4 2" name="benchmark" />
                )}
                {mainLines.afterTax === true && (
                  <Line type="monotone" dataKey="afterTax" stroke="#22c55e" strokeWidth={0.9} dot={false} strokeDasharray="6 3" name="afterTax" />
                )}
                {/* Rebalance markers — adaptive opacity, subtle style */}
                {chartData.filter(d => d.rebalanced).map((d, i) => {
                  const isActive = activeRebalanceDate === d.date
                  const faintColor = rebalanceEvents.length <= 40 ? '#22c55e20'
                    : rebalanceEvents.length <= 100 ? '#22c55e15' : '#22c55e0a'
                  return (
                    <ReferenceLine key={i} x={d.date}
                      stroke={isActive ? '#ffffff55' : faintColor}
                      strokeWidth={isActive ? 1.5 : 0.5} />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Row 2: Selectable secondary charts */}
          <div className="flex-[30] min-h-0 px-3 pb-2 flex flex-col">
            {/* Chart selector — checkbox style for multi-select */}
            <div className="flex gap-2 mb-1 shrink-0 items-center">
              <span className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Charts:</span>
              {(['Rolling TE', 'Net Realized P&L', 'Annual P&L', 'Drawdown'] as const).map((chart) => (
                <label key={chart} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleCharts.includes(chart)}
                    onChange={() => toggleChart(chart)}
                    className="accent-[var(--color-accent)] w-3 h-3"
                  />
                  <span className={`text-[10px] ${visibleCharts.includes(chart) ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}`}>
                    {chart}
                  </span>
                </label>
              ))}
            </div>

            <div className={`flex-1 min-h-0 grid gap-2 ${
              visibleCharts.length <= 1 ? 'grid-cols-1' :
              visibleCharts.length === 2 ? 'grid-cols-2' :
              visibleCharts.length === 3 ? 'grid-cols-3' : 'grid-cols-2 grid-rows-2'
            }`}>
              {visibleCharts.includes('Rolling TE') && (
                <ResponsiveContainer width="100%" height="100%" debounce={100}>
                  <LineChart data={chartData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
                    <XAxis dataKey="date" tick={false} height={0} />
                    <YAxis tick={{ fill: '#8888a0', fontSize: 10 }} domain={[0, 'auto']}
                      tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Tooltip contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                      formatter={(value: unknown) => [`${Number(value).toFixed(2)}%`, 'Rolling TE']} />
                    <Line type="monotone" dataKey="te" stroke="#a855f7" strokeWidth={1} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {visibleCharts.includes('Net Realized P&L') && (
                <ResponsiveContainer width="100%" height="100%" debounce={100}>
                  <LineChart data={cumulativePnlData} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
                    <XAxis dataKey="date" tick={false} height={0} />
                    <YAxis tick={{ fill: '#8888a0', fontSize: 10 }}
                      domain={[(dataMin: number) => Math.min(dataMin, 0), (dataMax: number) => Math.max(dataMax, 0)]} />
                    <Tooltip contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                      formatter={(value: unknown) => [formatMoney(Number(value)), 'Cumulative P&L']} />
                    <ReferenceLine y={0} stroke="#6a6a7a" strokeWidth={1} />
                    <Line type="monotone" dataKey="cumPnl" stroke="#22c55e" strokeWidth={1} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {visibleCharts.includes('Annual P&L') && (
                <ResponsiveContainer width="100%" height="100%" debounce={100}>
                  <BarChart data={annualPnlData} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
                    <XAxis dataKey="year" tick={{ fill: '#8888a0', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#8888a0', fontSize: 10 }}
                      domain={[(dataMin: number) => Math.min(dataMin, 0), (dataMax: number) => Math.max(dataMax, 0)]} />
                    <ReferenceLine y={0} stroke="#6a6a7a" strokeWidth={1} />
                    <Tooltip contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                      formatter={(value: unknown) => [formatMoney(Number(value))]} />
                    <Bar dataKey="pnl" fill="#00d4ff">
                      {annualPnlData.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}

              {visibleCharts.includes('Drawdown') && (
                <ResponsiveContainer width="100%" height="100%" debounce={100}>
                  <LineChart data={chartData} margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
                    <XAxis dataKey="date" tick={false} height={0} />
                    <YAxis tick={{ fill: '#8888a0', fontSize: 10 }} domain={['auto', 0]}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                    <Tooltip contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                      formatter={(value: unknown) => [`${Number(value).toFixed(2)}%`, 'Drawdown']} />
                    <Line type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Rebalance table — collapsible */}
          {rebalanceEvents.length > 0 && (
            <RebalanceTable
              events={rebalanceEvents}
              defaultExpanded={rebalanceEvents.length <= 25}
              onHoverDate={setActiveRebalanceDate}
            />
          )}
        </div>
      )}

        </div>{/* end flex-1 flex-col */}
      </div>{/* end flex min-h-0 */}
    </div>
  )
}
