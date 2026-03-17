import { useState, useCallback, useEffect } from 'react'
import { PipelineCanvas } from './components/graph/PipelineCanvas'
import { RunToolbar } from './components/toolbar/RunToolbar'
import { NavHeader } from './components/layout/NavHeader'
import { NodeInspector } from './components/panels/NodeInspector'
import { EventTimeline } from './components/panels/EventTimeline'
import { ResultDock } from './components/results/ResultDock'
import { setCurrency } from './lib/format'
import { DEMO_REPLAY, startReplay, getReplayParams } from './lib/replay'
import { ConfigPanel } from './components/config/ConfigPanel'
import { useAppStore } from './store/useAppStore'
import './index.css'

export type RunEvent = {
  seq: number
  run_id: string
  ts: string
  type: string
  node_id?: string
  status?: string
  payload: Record<string, unknown>
}

export type NodeStatusMap = Record<string, 'idle' | 'running' | 'completed' | 'failed'>

export type RunResult = {
  summary: Record<string, unknown>
  trades: Array<Record<string, unknown>>
  lot_dispositions: Array<Record<string, unknown>>
  target_weights: Record<string, number>
} | null

function App({ embedded }: { embedded?: boolean }) {
  const config = useAppStore((s) => s.config)
  const setConfig = useAppStore((s) => s.setConfig)
  const runStatus = useAppStore((s) => s.optimizeRunStatus)
  const nodeStatuses = useAppStore((s) => s.optimizeNodeStatuses)
  const events = useAppStore((s) => s.optimizeEvents)
  const result = useAppStore((s) => s.optimizeResult)
  const selectedNode = useAppStore((s) => s.optimizeSelectedNode)
  const setOptimizeState = useAppStore((s) => s.setOptimizeState)
  const saveRun = useAppStore((s) => s.saveRun)
  const savedRuns = useAppStore((s) => s.savedRuns)
  const activeRunId = useAppStore((s) => s.activeRunId)
  const setActiveRun = useAppStore((s) => s.setActiveRun)
  const removeRun = useAppStore((s) => s.removeRun)

  const setRunStatus = (s: string) => setOptimizeState({ optimizeRunStatus: s })
  const setNodeStatusesDirect = (v: NodeStatusMap) => setOptimizeState({ optimizeNodeStatuses: v })
  const setEventsDirect = (v: RunEvent[]) => setOptimizeState({ optimizeEvents: v })
  const setResult = (r: RunResult) => setOptimizeState({ optimizeResult: r })
  const setSelectedNode = (n: string | null) => setOptimizeState({ optimizeSelectedNode: n })

  const [showConfig, setShowConfig] = useState(false)

  const handleRun = useCallback(async () => {
    setNodeStatusesDirect({})
    setEventsDirect([])
    setResult(null)
    setSelectedNode(null)
    setRunStatus('starting')

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset_id: config.preset_id,
        risk_model: config.risk_model,
        disposal_method: config.disposal_method,
        tax_jurisdiction: config.tax_jurisdiction,
        period: config.period,
        rebalance_frequency: config.rebalance_frequency,
        objective: {
          tracking_error: config.lambda_te,
          transaction_cost: config.lambda_tcost,
          tax_cost: config.lambda_tax,
        },
        constraints: {
          max_turnover: config.max_turnover,
          cash_buffer: config.cash_buffer,
          max_weight: config.max_weight,
        },
        tax_rate: config.tax_rate,
      }),
    })
    const { run_id } = await res.json()
    setRunStatus('running')

    const wsUrl = `ws://${window.location.host}/api/ws/runs/${run_id}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (msg) => {
      const event: RunEvent = JSON.parse(msg.data)
      const store = useAppStore.getState()
      setOptimizeState({ optimizeEvents: [...store.optimizeEvents, event] })

      if (event.node_id) {
        const updated = { ...store.optimizeNodeStatuses }
        if (event.type === 'node.started') {
          updated[event.node_id] = 'running'
        } else if (event.type === 'node.completed') {
          updated[event.node_id] = 'completed'
        } else if (event.type === 'node.failed') {
          updated[event.node_id] = 'failed'
        }
        setOptimizeState({ optimizeNodeStatuses: updated })
      }

      if (event.type === 'run.completed') {
        setRunStatus('completed')
        const payload = event.payload as Record<string, unknown>
        // Set currency from portfolio metadata
        const portfolio = payload.portfolio as Record<string, unknown> | undefined
        if (portfolio?.currency) {
          setCurrency(String(portfolio.currency))
        }
        const runResult = {
          summary: (payload.summary as Record<string, unknown>) || {},
          trades: (payload.trades as Array<Record<string, unknown>>) || [],
          lot_dispositions: (payload.lot_dispositions as Array<Record<string, unknown>>) || [],
          target_weights: (payload.target_weights as Record<string, number>) || {},
        }
        setResult(runResult)
        // Save to run history
        saveRun({
          id: run_id,
          label: `${config.risk_model} λ_te=${config.lambda_te}`,
          source: 'optimize',
          config: { ...config },
          result: runResult,
          events: [],
          timestamp: Date.now(),
        })
        ws.close()
      } else if (event.type === 'run.failed') {
        setRunStatus('failed')
        ws.close()
      }
    }
  }, [config, setOptimizeState, setRunStatus, setResult, saveRun])

  // Replay mode: auto-start demo on mount
  const handleReplay = useCallback(() => {
    setNodeStatusesDirect({})
    setEventsDirect([])
    setResult(null)
    setSelectedNode(null)
    setRunStatus('running')

    const processEvent = (event: RunEvent) => {
      const store = useAppStore.getState()
      setOptimizeState({ optimizeEvents: [...store.optimizeEvents, event] })
      if (event.node_id) {
        const updated = { ...store.optimizeNodeStatuses }
        if (event.type === 'node.started') updated[event.node_id] = 'running'
        else if (event.type === 'node.completed') updated[event.node_id] = 'completed'
        setOptimizeState({ optimizeNodeStatuses: updated })
      }
    }

    startReplay(DEMO_REPLAY, processEvent, (res) => {
      setRunStatus('completed')
      if (res.portfolio?.currency) setCurrency(String(res.portfolio.currency))
      setResult({
        summary: res.summary,
        trades: res.trades,
        lot_dispositions: res.lot_dispositions,
        target_weights: res.target_weights,
      })
    })
  }, [])

  useEffect(() => {
    const { replay, autostart } = getReplayParams()
    if (replay === 'demo' && autostart) {
      handleReplay()
    }
  }, [handleReplay])

  return (
    <div className={`flex flex-col ${embedded ? 'h-full' : 'h-screen'} bg-[var(--color-bg)]`}>
      {/* Header — hidden when embedded in Shell */}
      {!embedded && (
      <NavHeader
        activeView="optimize"
        rightContent={
          <div className="flex items-center gap-3">
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
            <RunToolbar onRun={handleRun} runStatus={runStatus} />
          </div>
        }
      />
      )}

      {/* Embedded toolbar (when inside Shell) */}
      {embedded && (
        <div className="flex items-center justify-between px-4 h-10 border-b border-[var(--color-border)] shrink-0">
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
          <RunToolbar onRun={handleRun} runStatus={runStatus} />
        </div>
      )}

      {/* Main content: config sidebar + graph + right rail */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: config (VS Code-style, pushes content) */}
        {showConfig && (
          <div className="w-72 border-r border-[var(--color-border)] overflow-y-auto shrink-0 bg-[var(--color-surface)]">
            <ConfigPanel config={config} onChange={setConfig} />
          </div>
        )}

        {/* Pipeline graph */}
        <div className="flex-1">
          <PipelineCanvas
            nodeStatuses={nodeStatuses}
            onNodeClick={setSelectedNode}
          />
        </div>

        {/* Right rail: inspector + events */}
        <div className="w-96 border-l border-[var(--color-border)] flex flex-col">
          <div className="flex-[65] overflow-y-auto border-b border-[var(--color-border)]">
            <NodeInspector
              selectedNode={selectedNode}
              nodeStatuses={nodeStatuses}
              events={events}
              result={result}
            />
          </div>
          <div className="flex-[35] overflow-y-auto">
            <EventTimeline events={events} />
          </div>
        </div>
      </div>

      {/* Run history tabs */}
      {(result || savedRuns.length > 0) && (
        <div className="flex items-center border-t border-[var(--color-border)] bg-[var(--color-surface)] px-2 shrink-0 overflow-x-auto gap-0.5 py-0.5">
          {/* Current run tab */}
          {result && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs mono cursor-pointer rounded-t transition-colors max-w-[220px] ${
                activeRunId === null
                  ? 'border border-b-0 border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-surface-2)]'
                  : 'border border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
              }`}
              onClick={() => {
                setActiveRun(null)
                setResult(result)
              }}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                runStatus === 'completed' ? 'bg-emerald-400' : runStatus === 'running' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-500'
              }`} />
              <span className="truncate font-medium">Current</span>
            </div>
          )}
          {/* Saved run tabs */}
          {savedRuns.map((run) => {
            const te = run.result?.summary?.tracking_error
            const teStr = typeof te === 'number' ? ` TE=${(te * 100).toFixed(1)}%` : ''
            const tradeCount = run.result?.trades?.length ?? 0
            return (
              <div
                key={run.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs mono cursor-pointer rounded-t transition-colors max-w-[260px] ${
                  activeRunId === run.id
                    ? 'border border-b-0 border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-surface-2)]'
                    : 'border border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
                }`}
                onClick={() => {
                  setActiveRun(run.id)
                  setResult(run.result)
                }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate" title={`${run.config.risk_model} | λ_te=${run.config.lambda_te}${teStr} | ${tradeCount} trades`}>
                  {run.config.risk_model} <span className="text-[var(--color-text-dim)]">λ={run.config.lambda_te}</span>{teStr} <span className="text-[var(--color-text-dim)]">{tradeCount}T</span>
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeRun(run.id) }}
                  className="text-[var(--color-text-dim)] hover:text-[var(--color-error)] ml-0.5 shrink-0"
                >×</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Bottom dock: results */}
      <ResultDock result={result} runStatus={runStatus} />
    </div>
  )
}

export default App
