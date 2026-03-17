type Props = {
  summary: Record<string, unknown> | null
  runStatus: string
}

function KPI({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">
        {label}
      </span>
      <span className="text-lg font-bold mono text-[var(--color-text)]">
        {value}
        {unit && <span className="text-xs text-[var(--color-text-dim)] ml-1">{unit}</span>}
      </span>
    </div>
  )
}

export function SummaryStrip({ summary, runStatus }: Props) {
  if (runStatus === 'idle') {
    return (
      <div className="h-16 border-t border-[var(--color-border)] flex items-center justify-center">
        <span className="text-sm text-[var(--color-text-dim)]">
          Ready to optimize
        </span>
      </div>
    )
  }

  if (!summary || runStatus === 'running') {
    return (
      <div className="h-16 border-t border-[var(--color-border)] flex items-center justify-center">
        <span className="text-sm text-[var(--color-accent)] animate-pulse">
          Optimizing...
        </span>
      </div>
    )
  }

  const te = Number(summary.tracking_error || 0)
  const turnover = Number(summary.turnover || 0)
  const taxCost = Number(summary.estimated_tax_cost || 0)
  const txnCost = Number(summary.estimated_transaction_cost || 0)
  const trades = Number(summary.trade_count || 0)

  return (
    <div className="h-16 border-t border-[var(--color-border)] flex items-center justify-around px-8">
      <KPI label="Tracking Error" value={`${(te * 100).toFixed(2)}%`} />
      <KPI label="Turnover" value={`${(turnover * 100).toFixed(2)}%`} />
      <KPI label="Tax Cost" value={`¥${taxCost.toLocaleString()}`} />
      <KPI label="Txn Cost" value={`¥${txnCost.toLocaleString()}`} />
      <KPI label="Trades" value={String(trades)} />
      <div className="flex items-center gap-2">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-success)]" />
        <span className="text-xs text-[var(--color-success)] mono uppercase">Solved</span>
      </div>
    </div>
  )
}
