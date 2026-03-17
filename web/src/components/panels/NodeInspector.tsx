import type { RunEvent, NodeStatusMap, RunResult } from '../../App'
import { formatMoney, formatPct } from '../../lib/format'

type Props = {
  selectedNode: string | null
  nodeStatuses: NodeStatusMap
  events: RunEvent[]
  result: RunResult
}

const nodeInfo: Record<string, { label: string; type: string; description: string }> = {
  'source.stockprice': { label: 'Stock Prices', type: 'Data Source', description: 'Historical and real-time price data via yfinance' },
  'source.edinet': { label: 'EDINET Filings', type: 'Data Source', description: 'Financial statements and XBRL disclosures' },
  'source.estat': { label: 'Macro Stats', type: 'Data Source', description: 'Government economic statistics (e-Stat)' },
  'source.tdnet': { label: 'Disclosures', type: 'Data Source', description: 'Timely corporate disclosures (TDnet)' },
  'agent.researcher': { label: 'Researcher', type: 'AI Agent', description: 'Analyzes financial data, identifies investment signals' },
  'agent.macro': { label: 'Macro Analyst', type: 'AI Agent', description: 'Evaluates macroeconomic environment and sector trends' },
  'agent.verifier': { label: 'Verifier', type: 'AI Agent', description: 'Cross-checks analysis, validates data consistency' },
  'risk.model': { label: 'Risk Model', type: 'Risk Engine', description: 'Covariance estimation (EWMA / Shrinkage / Factor / Blend)' },
  'optimizer.main': { label: 'Optimizer', type: 'QP Solver', description: 'OSQP convex optimizer: min TE + tax cost + transaction cost' },
  'output.trades': { label: 'Trades', type: 'Output', description: 'Optimal trade list with buy/sell quantities' },
  'output.taxlots': { label: 'Tax Lots', type: 'Output', description: 'Per-lot disposition with realized gain/loss and tax' },
  'output.summary': { label: 'Summary', type: 'Output', description: 'KPI summary: TE, turnover, costs, solver status' },
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: 'bg-[var(--color-border)] text-[var(--color-text-dim)]',
    running: 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]',
    completed: 'bg-[var(--color-success)]/20 text-[var(--color-success)]',
    failed: 'bg-[var(--color-error)]/20 text-[var(--color-error)]',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs mono uppercase ${colors[status] || colors.idle}`}>
      {status}
    </span>
  )
}

function OptimizerDetail({ result }: { result: RunResult }) {
  if (!result) return null
  const s = result.summary
  return (
    <div className="space-y-3">
      <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Objective Breakdown</h4>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-[var(--color-surface-2)] rounded p-2">
          <span className="text-[var(--color-text-dim)] text-xs">Tracking Error</span>
          <div className="mono text-[var(--color-text)]">{formatPct(s.tracking_error as number)}</div>
        </div>
        <div className="bg-[var(--color-surface-2)] rounded p-2">
          <span className="text-[var(--color-text-dim)] text-xs">Turnover</span>
          <div className="mono text-[var(--color-text)]">{formatPct(s.turnover as number)}</div>
        </div>
        <div className="bg-[var(--color-surface-2)] rounded p-2">
          <span className="text-[var(--color-text-dim)] text-xs">Tax Cost</span>
          <div className="mono text-[var(--color-text)]">{formatMoney(s.estimated_tax_cost as number)}</div>
        </div>
        <div className="bg-[var(--color-surface-2)] rounded p-2">
          <span className="text-[var(--color-text-dim)] text-xs">Txn Cost</span>
          <div className="mono text-[var(--color-text)]">{formatMoney(s.estimated_transaction_cost as number)}</div>
        </div>
      </div>
      <div className="bg-[var(--color-surface-2)] rounded p-2">
        <span className="text-[var(--color-text-dim)] text-xs">Solver</span>
        <div className="mono text-[var(--color-success)] text-sm">OSQP — Converged</div>
      </div>
    </div>
  )
}

function TradesDetail({ result }: { result: RunResult }) {
  if (!result || result.trades.length === 0) return <p className="text-sm text-[var(--color-text-dim)]">No trades</p>
  return (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Trade List</h4>
      <table className="w-full text-xs mono">
        <thead>
          <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
            <th className="text-left py-1">Asset</th>
            <th className="text-left">Side</th>
            <th className="text-right">Shares</th>
            <th className="text-right">Notional</th>
          </tr>
        </thead>
        <tbody>
          {result.trades.map((t, i) => (
            <tr key={i} className="border-b border-[var(--color-border)]/50">
              <td className="py-1 text-[var(--color-text)]">{String(t.asset_id)}</td>
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

export function NodeInspector({ selectedNode, nodeStatuses, events, result }: Props) {
  if (!selectedNode) {
    return (
      <div className="p-4">
        <h3 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">Inspector</h3>
        <p className="text-sm text-[var(--color-text-dim)]">Click a node to inspect</p>
      </div>
    )
  }

  const info = nodeInfo[selectedNode]
  const status = nodeStatuses[selectedNode] || 'idle'
  const nodeEvents = events.filter((e) => e.node_id === selectedNode)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
            {info?.type || 'Node'}
          </span>
          <StatusBadge status={status} />
        </div>
        <h3 className="text-lg font-medium text-[var(--color-text)]">{info?.label || selectedNode}</h3>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">{info?.description}</p>
      </div>

      {/* Node-specific detail */}
      {selectedNode === 'optimizer.main' && result && <OptimizerDetail result={result} />}
      {selectedNode === 'output.trades' && result && <TradesDetail result={result} />}
      {selectedNode === 'output.taxlots' && result && (
        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Tax Lot Dispositions</h4>
          {result.lot_dispositions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-dim)]">No dispositions</p>
          ) : (
            <table className="w-full text-xs mono">
              <thead>
                <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
                  <th className="text-left py-1">Lot</th>
                  <th className="text-left">Asset</th>
                  <th className="text-right">Gain/Loss</th>
                  <th className="text-right">Tax</th>
                </tr>
              </thead>
              <tbody>
                {result.lot_dispositions.map((d, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)]/50">
                    <td className="py-1">#{String(d.lot_id)}</td>
                    <td>{String(d.asset_id)}</td>
                    <td className={`text-right ${Number(d.realized_gain) >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                      {formatMoney(Number(d.realized_gain))}
                    </td>
                    <td className="text-right">{formatMoney(Number(d.tax_liability))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Events for this node */}
      {nodeEvents.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">Events</h4>
          <div className="space-y-1">
            {nodeEvents.map((ev) => (
              <div key={ev.seq} className="text-xs mono text-[var(--color-text-dim)]">
                <span className={
                  ev.type.includes('completed') ? 'text-[var(--color-success)]' :
                  ev.type.includes('started') ? 'text-[var(--color-accent)]' :
                  'text-[var(--color-text-dim)]'
                }>
                  {ev.type.split('.')[1]}
                </span>
                {'message' in ev.payload && ` — ${String(ev.payload.message)}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
