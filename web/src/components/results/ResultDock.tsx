import { useState, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { RunResult } from '../../App'
import { formatMoney, formatPct } from '../../lib/format'

type Props = {
  result: RunResult
  runStatus: string
}

const tabs = ['Overview', 'Allocation', 'Trades', 'Tax Lots'] as const
type Tab = typeof tabs[number]

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface-2)] rounded-lg p-3 flex flex-col items-center overflow-hidden">
      <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider truncate w-full text-center">{label}</span>
      <span className="text-lg font-bold mono text-[var(--color-text)] mt-1 truncate w-full text-center">{value}</span>
    </div>
  )
}

// Demo NAV data (replaced with real backtest data in Day 3)
function generateDemoNAV() {
  const data = []
  let port = 100, bench = 100
  for (let i = 0; i < 120; i++) {
    const month = Math.floor(i / 20)
    const noise = Math.sin(i * 0.15) * 1.5 + Math.cos(i * 0.08) * 2
    port += 0.15 + noise * 0.3 + (Math.random() - 0.48) * 0.8
    bench += 0.14 + noise * 0.28 + (Math.random() - 0.48) * 0.7
    data.push({
      day: i,
      label: `M${month + 1}`,
      portfolio: Number(port.toFixed(2)),
      benchmark: Number(bench.toFixed(2)),
      te: Number((Math.abs(port - bench) * 0.15 + Math.random() * 1.5).toFixed(2)),
    })
  }
  return data
}

const demoNAV = generateDemoNAV()

function OverviewTab({ result }: { result: RunResult }) {
  if (!result) return null
  const s = result.summary
  return (
    <div className="flex h-full p-3 gap-3">
      {/* Left: KPI grid */}
      <div className="w-[35%] shrink-0 grid grid-cols-2 gap-2 content-start">
        <KPI label="Tracking Error" value={formatPct(s.tracking_error as number)} />
        <KPI label="Turnover" value={formatPct(s.turnover as number)} />
        <KPI label="Tax Cost" value={formatMoney(s.estimated_tax_cost as number)} />
        <KPI label="Trades" value={String(s.trade_count)} />
        <KPI label="Txn Cost" value={formatMoney(s.estimated_transaction_cost as number)} />
        <KPI label="Solver" value={s.converged ? 'Converged' : 'Failed'} />
      </div>

      {/* Right: NAV + TE charts */}
      <div className="flex-1 flex flex-col gap-2">
        {/* NAV Chart */}
        <div className="flex-[60] min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={demoNAV} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
              <XAxis dataKey="label" tick={{ fill: '#8888a0', fontSize: 10 }} interval={19} />
              <YAxis tick={{ fill: '#8888a0', fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#8888a0' }}
              />
              <Line type="monotone" dataKey="portfolio" stroke="#00d4ff" strokeWidth={1.5} dot={false} name="Portfolio" />
              <Line type="monotone" dataKey="benchmark" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Target Benchmark" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Rolling TE */}
        <div className="flex-[40] min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={demoNAV} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
              <XAxis dataKey="label" tick={false} height={0} />
              <YAxis tick={{ fill: '#8888a0', fontSize: 10 }} domain={[0, 'auto']} />
              <Line type="monotone" dataKey="te" stroke="#a855f7" strokeWidth={1} dot={false} name="Rolling TE %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function AllocationTab({ result }: { result: RunResult }) {
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')

  if (!result || Object.keys(result.target_weights).length === 0) {
    return <p className="p-4 text-sm text-[var(--color-text-dim)]">No allocation data</p>
  }

  const allEntries = Object.entries(result.target_weights).sort((a, b) => b[1] - a[1])
  const filtered = search
    ? allEntries.filter(([a]) => a.toLowerCase().includes(search.toLowerCase()))
    : allEntries
  const DEFAULT_SHOW = 20
  const entries = showAll ? filtered : filtered.slice(0, DEFAULT_SHOW)
  const maxWeight = Math.max(...allEntries.map(([, w]) => w))
  const hasMore = filtered.length > DEFAULT_SHOW && !showAll

  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Search + toggle */}
      {allEntries.length > DEFAULT_SHOW && (
        <div className="flex items-center gap-2 mb-2">
          <input
            type="text"
            placeholder="Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-dim)] w-40 outline-none focus:border-[var(--color-accent)]"
          />
          <span className="text-xs text-[var(--color-text-dim)]">
            {entries.length}/{allEntries.length} assets
          </span>
        </div>
      )}

      <div className="space-y-1">
        {entries.map(([asset, weight]) => (
          <div key={asset} className="flex items-center gap-3 text-sm">
            <span className="w-20 mono text-[var(--color-text-dim)] text-xs text-right shrink-0">{asset}</span>
            <div className="flex-1 h-5 bg-[var(--color-surface-2)] rounded overflow-hidden">
              <div
                className="h-full rounded bg-[var(--color-accent)]"
                style={{ width: `${(weight / maxWeight) * 100}%`, opacity: 0.7 }}
              />
            </div>
            <span className="w-14 mono text-xs text-right shrink-0">{(weight * 100).toFixed(1)}%</span>
        </div>
      ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
        >
          Show all {filtered.length} assets
        </button>
      )}
    </div>
  )
}

function TradesTab({ result }: { result: RunResult }) {
  if (!result || result.trades.length === 0) {
    return <p className="p-4 text-sm text-[var(--color-text-dim)]">No trades</p>
  }
  return (
    <div className="p-4 overflow-y-auto">
      <table className="w-full text-sm mono">
        <thead>
          <tr className="text-[var(--color-text-dim)] text-xs border-b border-[var(--color-border)]">
            <th className="text-left py-2">Asset</th>
            <th className="text-left">Name</th>
            <th className="text-left">Side</th>
            <th className="text-right">Shares</th>
            <th className="text-right">Notional</th>
          </tr>
        </thead>
        <tbody>
          {result.trades.map((t, i) => (
            <tr key={i} className="border-b border-[var(--color-border)]/30">
              <td className="py-1.5">{String(t.asset_id)}</td>
              <td className="text-[var(--color-text-dim)]">{String(t.name || '')}</td>
              <td className={String(t.side) === 'buy' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                {String(t.side).toUpperCase()}
              </td>
              <td className="text-right">{Number(t.shares).toFixed(0)}</td>
              <td className="text-right">{formatMoney(Number(t.notional))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TaxLotsTab({ result }: { result: RunResult }) {
  if (!result || result.lot_dispositions.length === 0) {
    return <p className="p-4 text-sm text-[var(--color-text-dim)]">No tax lot dispositions</p>
  }
  return (
    <div className="p-4 overflow-y-auto">
      <table className="w-full text-sm mono">
        <thead>
          <tr className="text-[var(--color-text-dim)] text-xs border-b border-[var(--color-border)]">
            <th className="text-left py-2">Lot</th>
            <th className="text-left">Asset</th>
            <th className="text-right">Shares Sold</th>
            <th className="text-right">Realized P&L</th>
            <th className="text-right">Tax</th>
          </tr>
        </thead>
        <tbody>
          {result.lot_dispositions.map((d, i) => (
            <tr key={i} className="border-b border-[var(--color-border)]/30">
              <td className="py-1.5">#{String(d.lot_id)}</td>
              <td>{String(d.asset_id)}</td>
              <td className="text-right">{Number(d.shares_sold).toFixed(0)}</td>
              <td className={`text-right ${Number(d.realized_gain) >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                {formatMoney(Number(d.realized_gain))}
              </td>
              <td className="text-right">{formatMoney(Number(d.tax_liability))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ResultDock({ result, runStatus }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const [collapsed, setCollapsed] = useState(true)

  // Auto-expand when run completes
  const prevStatus = useRef(runStatus)
  if (prevStatus.current !== 'completed' && runStatus === 'completed') {
    if (collapsed) setCollapsed(false)
  }
  prevStatus.current = runStatus

  if (runStatus === 'idle') {
    return (
      <div className="h-10 border-t border-[var(--color-border)] flex items-center justify-center shrink-0">
        <span className="text-sm text-[var(--color-text-dim)]">Ready to optimize</span>
      </div>
    )
  }

  if (runStatus === 'running' || runStatus === 'starting') {
    return (
      <div className="h-10 border-t border-[var(--color-border)] flex items-center justify-center shrink-0">
        <span className="text-sm text-[var(--color-accent)] animate-pulse">Optimizing...</span>
      </div>
    )
  }

  return (
    <div
      className={`border-t border-[var(--color-border)] flex flex-col shrink-0 bg-[var(--color-surface)] transition-all duration-300 ${
        collapsed ? 'h-10' : 'h-[304px]'
      }`}
    >
      {/* Tab bar + collapse toggle */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              if (collapsed) setCollapsed(false)
            }}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === tab && !collapsed
                ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 px-4">
          {result && (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)]" />
              <span className="text-xs mono text-[var(--color-success)]">SOLVED</span>
            </>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-2 text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Tab content — hidden when collapsed */}
      {!collapsed && (
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'Overview' && <OverviewTab result={result} />}
        {activeTab === 'Allocation' && <AllocationTab result={result} />}
        {activeTab === 'Trades' && <TradesTab result={result} />}
        {activeTab === 'Tax Lots' && <TaxLotsTab result={result} />}
      </div>
      )}
    </div>
  )
}
