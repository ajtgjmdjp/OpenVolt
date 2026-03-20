import { useState, useCallback } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts'
import { formatMoney, formatPct } from '../lib/format'
import { ConfigPanel } from '../components/config/ConfigPanel'
import { useAppStore } from '../store/useAppStore'

type RunEntry = {
  index: number
  label: string
  param_value?: number
  params?: Record<string, number>
  summary: {
    tracking_error: number
    turnover: number
    estimated_tax_cost: number
    estimated_transaction_cost: number
    trade_count: number
    converged: boolean
  }
}

type ExperimentResult = {
  status: string
  runs: RunEntry[]
  total: number
  completed?: number
  aggregate?: Record<string, { mean: number; std: number; p5: number; p50: number; p95: number }>
  error?: string
}

type Mode = 'sweep' | 'montecarlo'

export function ExperimentsView() {
  const config = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const [showConfig, setShowConfig] = useState(false)

  const [mode, setMode] = useState<Mode>('sweep')
  const [result, setResult] = useState<ExperimentResult | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle')
  const [selected, setSelected] = useState<RunEntry | null>(null)

  const [saving, setSaving] = useState<number | null>(null)

  const saveRunToWorkspace = async (run: RunEntry) => {
    setSaving(run.index)
    try {
      await fetch('/api/workspace/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `${mode}_run_${run.index}_${Date.now()}`,
          kind: 'run',
          title: `${config.preset_id} · ${run.label}`,
          config: { preset_id: config.preset_id, risk_model: config.risk_model, ...(run.params || {}) },
          summary: run.summary,
        }),
      })
    } catch { /* ignore */ }
    setSaving(null)
  }

  // Sweep params
  const [sweepParam, setSweepParam] = useState('lambda_te')
  const [sweepValues, setSweepValues] = useState('50,100,150,200,300,500,800')

  // Monte Carlo params
  const [nSims, setNSims] = useState(50)

  const handleRun = useCallback(async () => {
    setStatus('running')
    setResult(null)
    setSelected(null)

    try {
      let endpoint: string
      let body: Record<string, unknown>

      if (mode === 'sweep') {
        endpoint = '/api/experiments/sweep'
        body = {
          preset_id: config.preset_id,
          sweep_param: sweepParam,
          sweep_values: sweepValues.split(',').map(Number),
          risk_model: config.risk_model,
          period: config.period,
          rebalance_frequency: config.rebalance_frequency,
          objective: {
            tracking_error: config.lambda_te,
            transaction_cost: config.lambda_tcost,
            tax_cost: config.lambda_tax,
          },
        }
      } else {
        endpoint = '/api/experiments/montecarlo'
        body = {
          preset_id: config.preset_id,
          n_simulations: nSims,
          risk_model: config.risk_model,
          period: config.period,
          rebalance_frequency: config.rebalance_frequency,
          objective: {
            tracking_error: config.lambda_te,
            transaction_cost: config.lambda_tcost,
            tax_cost: config.lambda_tax,
          },
        }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const { job_id } = await res.json()

      // Poll
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const poll = await fetch(`/api/experiments/${job_id}`)
        const data: ExperimentResult = await poll.json()
        setResult(data)

        if (data.status === 'completed') {
          setStatus('completed')
          return
        }
        if (data.status === 'failed') {
          setStatus('failed')
          return
        }
      }
    } catch (e) {
      setStatus('failed')
    }
  }, [mode, sweepParam, sweepValues, nSims, config])

  const runs = result?.runs || []

  // Chart data
  const scatterData = runs.map((r) => ({
    ...r,
    x: r.summary.tracking_error * 100,
    y: r.summary.estimated_tax_cost,
    turnover: r.summary.turnover * 100,
  }))

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      <div className="flex items-center justify-between px-4 h-10 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-dim)] mono">
              {config.preset_id} · {config.risk_model}
            </span>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                showConfig
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
              }`}
            >⚙ Settings</button>
            {/* Mode toggle */}
            <div className="flex bg-[var(--color-surface-2)] rounded overflow-hidden">
              <button
                onClick={() => setMode('sweep')}
                className={`px-3 py-1 text-xs ${mode === 'sweep' ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-dim)]'}`}
              >Sweep</button>
              <button
                onClick={() => setMode('montecarlo')}
                className={`px-3 py-1 text-xs ${mode === 'montecarlo' ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-dim)]'}`}
              >Monte Carlo</button>
            </div>

            {/* Mode-specific params */}
            {mode === 'sweep' && (
              <div className="flex items-center gap-2">
                <select
                  value={sweepParam}
                  onChange={(e) => setSweepParam(e.target.value)}
                  className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)]"
                >
                  <option value="lambda_te">λ_te</option>
                  <option value="lambda_tax">λ_tax</option>
                  <option value="lambda_tcost">λ_tcost</option>
                </select>
                <input
                  value={sweepValues}
                  onChange={(e) => setSweepValues(e.target.value)}
                  className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] w-48 mono"
                  placeholder="50,100,200..."
                />
              </div>
            )}
            {mode === 'montecarlo' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-dim)]">Simulations:</span>
                <input
                  type="number"
                  value={nSims}
                  onChange={(e) => setNSims(Number(e.target.value))}
                  className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] w-16 mono"
                  min={10} max={1000}
                />
              </div>
            )}

            <button
              onClick={handleRun}
              disabled={status === 'running'}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-all ${
                status === 'running'
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] cursor-not-allowed'
                  : 'bg-[var(--color-accent)] text-black hover:brightness-110 cursor-pointer'
              }`}
            >
              {status === 'running'
                ? `Running... ${result?.completed || 0}/${result?.total || '?'}`
                : `▶ Run ${mode === 'sweep' ? 'Sweep' : 'Monte Carlo'}`}
            </button>
          </div>
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
            <span className="text-5xl mb-4 block">🔬</span>
            <h2 className="text-xl font-medium text-[var(--color-text)] mb-2">Experiments</h2>
            <p className="text-sm text-[var(--color-text-dim)]">
              {mode === 'sweep'
                ? 'Sweep optimization parameters and compare results'
                : 'Run Monte Carlo simulations with parameter perturbation'}
            </p>
          </div>
        </div>
      )}

      {(status === 'running' || status === 'completed') && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main area */}
          <div className="flex-1 flex flex-col">
            {/* Aggregate stats for Monte Carlo */}
            {mode === 'montecarlo' && result?.aggregate && (
              <div className="grid grid-cols-6 gap-2 p-3 shrink-0">
                {(['tracking_error', 'estimated_tax_cost', 'turnover'] as const).map((metric) => {
                  const agg = result.aggregate![metric]
                  if (!agg) return null
                  const isPercent = metric === 'tracking_error' || metric === 'turnover'
                  return (
                    <div key={metric} className="col-span-2 bg-[var(--color-surface-2)] rounded-lg p-2">
                      <div className="text-[10px] text-[var(--color-text-dim)] uppercase">{metric.replace(/_/g, ' ')}</div>
                      <div className="flex gap-3 mt-1 text-xs mono">
                        <span>Mean: {isPercent ? formatPct(agg.mean) : formatMoney(agg.mean)}</span>
                        <span className="text-[var(--color-text-dim)]">
                          P5-P95: {isPercent ? `${formatPct(agg.p5)}-${formatPct(agg.p95)}` : `${formatMoney(agg.p5)}-${formatMoney(agg.p95)}`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Scatter: TE vs Tax Cost */}
            <div className="flex-[50] min-h-0 p-3">
              <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
                {mode === 'sweep' ? 'Parameter Sweep: TE vs Tax Cost' : 'Monte Carlo: TE vs Tax Cost'}
              </div>
              <ResponsiveContainer width="100%" height="90%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a26" />
                  <XAxis dataKey="x" name="TE (%)" tick={{ fill: '#8888a0', fontSize: 10 }}
                    type="number" domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                    label={{ value: 'Tracking Error (%)', position: 'bottom', fill: '#8888a0', fontSize: 11 }} />
                  <YAxis dataKey="y" name="Tax Cost" tick={{ fill: '#8888a0', fontSize: 10 }}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `${v.toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: '#12121a', border: '1px solid #2a2a3a', borderRadius: 6, fontSize: 12 }}
                    formatter={(value: unknown, name: unknown) => [
                      String(name) === 'TE (%)' ? `${Number(value).toFixed(2)}%` : formatMoney(Number(value)), String(name)
                    ]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''}
                  />
                  <Scatter data={scatterData} fill="#00d4ff">
                    {scatterData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={selected?.index === i ? '#22c55e' : '#00d4ff'}
                        cursor="pointer"
                        onClick={() => setSelected(runs[i])}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            {/* Results table */}
            <div className="flex-[50] min-h-0 px-3 pb-3 overflow-y-auto">
              <table className="w-full text-xs mono">
                <thead>
                  <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
                    <th className="text-left py-1.5">Label</th>
                    <th className="text-right">TE</th>
                    <th className="text-right">Turnover</th>
                    <th className="text-right">Tax Cost</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Converged</th>
                    <th className="text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.index}
                      onClick={() => setSelected(r)}
                      className={`border-b border-[var(--color-border)]/30 cursor-pointer transition-colors ${
                        selected?.index === r.index ? 'bg-[var(--color-surface-2)]' : 'hover:bg-[var(--color-surface-2)]/50'
                      }`}
                    >
                      <td className="py-1.5">{r.label}</td>
                      <td className="text-right">{formatPct(r.summary.tracking_error)}</td>
                      <td className="text-right">{formatPct(r.summary.turnover)}</td>
                      <td className="text-right">{formatMoney(r.summary.estimated_tax_cost)}</td>
                      <td className="text-right">{r.summary.trade_count}</td>
                      <td className="text-right">{r.summary.converged ? '✓' : '✗'}</td>
                      <td className="text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); saveRunToWorkspace(r) }}
                          disabled={saving === r.index}
                          className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)] px-1"
                          title="Save to workspace for comparison"
                        >{saving === r.index ? '...' : '💾'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right panel: selected detail */}
          <div className="w-72 border-l border-[var(--color-border)] p-4 overflow-y-auto">
            {selected ? (
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">Selected</span>
                  <h3 className="text-lg font-medium text-[var(--color-text)]">{selected.label}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[var(--color-surface-2)] rounded p-2">
                    <span className="text-[10px] text-[var(--color-text-dim)]">TE</span>
                    <div className="mono text-sm">{formatPct(selected.summary.tracking_error)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-2)] rounded p-2">
                    <span className="text-[10px] text-[var(--color-text-dim)]">Turnover</span>
                    <div className="mono text-sm">{formatPct(selected.summary.turnover)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-2)] rounded p-2">
                    <span className="text-[10px] text-[var(--color-text-dim)]">Tax Cost</span>
                    <div className="mono text-sm">{formatMoney(selected.summary.estimated_tax_cost)}</div>
                  </div>
                  <div className="bg-[var(--color-surface-2)] rounded p-2">
                    <span className="text-[10px] text-[var(--color-text-dim)]">Trades</span>
                    <div className="mono text-sm">{selected.summary.trade_count}</div>
                  </div>
                </div>
                <button
                  onClick={() => saveRunToWorkspace(selected)}
                  disabled={saving === selected.index}
                  className="w-full px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-black font-medium hover:brightness-110 disabled:opacity-50"
                >
                  {saving === selected.index ? 'Saving...' : '💾 Save to Compare'}
                </button>
                {selected.params && (
                  <div>
                    <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">Parameters</span>
                    <div className="mt-1 space-y-1">
                      {Object.entries(selected.params).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-xs mono">
                          <span className="text-[var(--color-text-dim)]">{k}</span>
                          <span>{typeof v === 'number' ? v.toFixed(1) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">Inspector</span>
                <p className="text-sm text-[var(--color-text-dim)] mt-2">Click a point or row to inspect</p>
              </div>
            )}
          </div>
        </div>
      )}

        </div>{/* end flex-1 flex-col */}
      </div>{/* end flex min-h-0 */}
    </div>
  )
}
