import { useState, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts'
import { formatMoney, formatPct } from '../lib/format'
import { ConfigPanel } from '../components/config/ConfigPanel'
import { useAppStore } from '../store/useAppStore'

type DailySnap = {
  date: string
  nav: number
  benchmark_nav: number
  portfolio_return: number
  benchmark_return: number
  rolling_te: number
  rebalanced: boolean
  trade_count: number
}

type BacktestResult = {
  summary: Record<string, unknown>
  daily: DailySnap[]
} | null

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

  const setResult = (r: BacktestResult | null) => setBacktestState({ backtestResult: r as any })
  const setStatus = (s: string) => setBacktestState({ backtestStatus: s })
  const setError = (e: string | null) => setBacktestState({ backtestError: e })

  const [showConfig, setShowConfig] = useState(false)

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
          period: config.period,
          rebalance_frequency: config.rebalance_frequency,
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
            label: `${config.preset_id} ${config.risk_model} ${config.period}`,
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


  // Chart data: normalize NAV to 100 + compute drawdown
  let peak = 100
  const chartData = daily.map((d) => {
    const portfolio = d.nav ? (d.nav / (daily[0]?.nav || 1)) * 100 : 100
    peak = Math.max(peak, portfolio)
    const drawdown = ((peak - portfolio) / peak) * -100

    return {
      date: d.date,  // Full date as key (unique)
      fullDate: d.date,
      portfolio,
      benchmark: d.benchmark_nav ? (d.benchmark_nav / (daily[0]?.benchmark_nav || 1)) * 100 : 100,
      te: d.rolling_te * 100,
      drawdown,
      rebalanced: d.rebalanced,
      trades: d.trade_count,
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
          <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto shrink-0 bg-[var(--color-surface)]">
            <ConfigPanel config={config} onChange={setConfig} />
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">

      {status === 'idle' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="text-5xl mb-4 block">📊</span>
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
            <KPI label="Benchmark" value={formatPct(s.annualized_benchmark_return as number)} />
            <KPI label="Volatility" value={formatPct(s.annualized_volatility as number)} />
            <KPI label="Tracking Error" value={formatPct(s.annualized_tracking_error as number)} />
            <KPI label="Sharpe" value={(s.sharpe_ratio as number).toFixed(2)} />
            <KPI label="Info Ratio" value={(s.information_ratio as number).toFixed(2)} />
            <KPI label="Max DD" value={formatPct(s.max_drawdown as number)} />
            <KPI label="Rebalances" value={String(s.total_rebalances)} />
          </div>

          {/* Main chart: NAV */}
          <div className="flex-[60] min-h-0 px-3">
            <ResponsiveContainer width="100%" height="100%">
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
                  formatter={(value: unknown, name: unknown) => [
                    `${Number(value).toFixed(1)}`,
                    name === 'portfolio' ? 'Portfolio' : 'Benchmark'
                  ]}
                />
                <Line type="monotone" dataKey="portfolio" stroke="#00d4ff" strokeWidth={1.5} dot={false} name="portfolio" />
                <Line type="monotone" dataKey="benchmark" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="benchmark" />
                {/* Rebalance markers */}
                {chartData.filter(d => d.rebalanced).map((d, i) => (
                  <ReferenceLine key={i} x={d.date} stroke="#22c55e33" strokeWidth={1} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Row 2: Selectable secondary charts */}
          <div className="flex-[30] min-h-0 px-3 pb-2 flex flex-col">
            {/* Chart selector — checkbox style for multi-select */}
            <div className="flex gap-2 mb-1 shrink-0 items-center">
              <span className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Charts:</span>
              {(['Drawdown', 'Rolling TE', 'Net Realized P&L', 'Annual P&L'] as const).map((chart) => (
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
              {visibleCharts.includes('Drawdown') && (
                <ResponsiveContainer width="100%" height="100%">
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

              {visibleCharts.includes('Rolling TE') && (
                <ResponsiveContainer width="100%" height="100%">
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
                <ResponsiveContainer width="100%" height="100%">
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
                <ResponsiveContainer width="100%" height="100%">
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
            </div>
          </div>

          {/* Rebalance table */}
          {rebalanceEvents.length > 0 && (
            <div className="h-36 shrink-0 px-3 pb-3 overflow-y-auto">
              <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                Rebalance Events ({rebalanceEvents.length})
              </div>
              <table className="w-full text-xs mono">
                <thead>
                  <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
                    <th className="text-left py-1">Date</th>
                    <th className="text-right">NAV</th>
                    <th className="text-right">Bench NAV</th>
                    <th className="text-right">Active Ret</th>
                    <th className="text-right">Rolling TE</th>
                    <th className="text-right">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {rebalanceEvents.map((d, i) => (
                    <tr key={i} className="border-b border-[var(--color-border)]/30">
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
      )}

        </div>{/* end flex-1 flex-col */}
      </div>{/* end flex min-h-0 */}
    </div>
  )
}
