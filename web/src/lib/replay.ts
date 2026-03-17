/**
 * Replay mode: plays back a recorded demo run for README GIFs.
 * Usage: append ?replay=demo&autostart=1 to the URL
 */

import type { RunEvent } from '../App'

export type ReplayBundle = {
  events: Array<{ at_ms: number } & RunEvent>
  result: {
    summary: Record<string, unknown>
    trades: Array<Record<string, unknown>>
    lot_dispositions: Array<Record<string, unknown>>
    target_weights: Record<string, number>
    portfolio?: Record<string, unknown>
  }
}

// Demo replay data — hand-crafted for optimal GIF
export const DEMO_REPLAY: ReplayBundle = {
  events: [
    { at_ms: 0, seq: 1, run_id: 'demo', ts: '', type: 'run.started', payload: {} },
    // Data sources
    { at_ms: 300, seq: 2, run_id: 'demo', ts: '', type: 'node.started', node_id: 'source.stockprice', payload: { message: 'Fetching stock prices...' } },
    { at_ms: 800, seq: 3, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'source.stockprice', payload: { message: '244 trading days loaded', status: 'completed' } },
    { at_ms: 900, seq: 4, run_id: 'demo', ts: '', type: 'node.started', node_id: 'source.edinet', payload: { message: 'Fetching EDINET filings...' } },
    { at_ms: 1300, seq: 5, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'source.edinet', payload: { message: '42 filings loaded', status: 'completed' } },
    { at_ms: 1400, seq: 6, run_id: 'demo', ts: '', type: 'node.started', node_id: 'source.estat', payload: { message: 'Fetching macro stats...' } },
    { at_ms: 1700, seq: 7, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'source.estat', payload: { message: 'GDP, CPI, employment data', status: 'completed' } },
    { at_ms: 1800, seq: 8, run_id: 'demo', ts: '', type: 'node.started', node_id: 'source.tdnet', payload: { message: 'Fetching disclosures...' } },
    { at_ms: 2100, seq: 9, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'source.tdnet', payload: { message: '18 disclosures', status: 'completed' } },
    // Agents
    { at_ms: 2300, seq: 10, run_id: 'demo', ts: '', type: 'node.started', node_id: 'agent.researcher', payload: { message: 'Analyzing fundamentals...' } },
    { at_ms: 3100, seq: 11, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'agent.researcher', payload: { message: 'Signal: overweight tech, underweight financials', status: 'completed' } },
    { at_ms: 3200, seq: 12, run_id: 'demo', ts: '', type: 'node.started', node_id: 'agent.macro', payload: { message: 'Evaluating macro environment...' } },
    { at_ms: 3900, seq: 13, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'agent.macro', payload: { message: 'Outlook: neutral, JPY weakening', status: 'completed' } },
    { at_ms: 4000, seq: 14, run_id: 'demo', ts: '', type: 'node.started', node_id: 'agent.verifier', payload: { message: 'Cross-checking analysis...' } },
    { at_ms: 4600, seq: 15, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'agent.verifier', payload: { message: 'Verified: no data conflicts', status: 'completed' } },
    // Risk model
    { at_ms: 4800, seq: 16, run_id: 'demo', ts: '', type: 'node.started', node_id: 'risk.model', payload: { message: 'Computing EWMA+shrinkage covariance...' } },
    { at_ms: 5200, seq: 17, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'risk.model', payload: { message: '10x10 covariance matrix ready', status: 'completed' } },
    // Optimizer
    { at_ms: 5400, seq: 18, run_id: 'demo', ts: '', type: 'node.started', node_id: 'optimizer.main', payload: { message: 'Solving QP (OSQP)...' } },
    { at_ms: 5800, seq: 19, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'optimizer.main', payload: { message: 'Converged in 2ms, 47 iterations', status: 'completed' } },
    // Outputs
    { at_ms: 6000, seq: 20, run_id: 'demo', ts: '', type: 'node.started', node_id: 'output.trades', payload: { message: 'Generating trade list...' } },
    { at_ms: 6200, seq: 21, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'output.trades', payload: { message: '2 trades generated', status: 'completed' } },
    { at_ms: 6300, seq: 22, run_id: 'demo', ts: '', type: 'node.started', node_id: 'output.taxlots', payload: { message: 'Computing tax dispositions...' } },
    { at_ms: 6500, seq: 23, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'output.taxlots', payload: { message: '2 lot dispositions', status: 'completed' } },
    { at_ms: 6600, seq: 24, run_id: 'demo', ts: '', type: 'node.started', node_id: 'output.summary', payload: { message: 'Building summary...' } },
    { at_ms: 6800, seq: 25, run_id: 'demo', ts: '', type: 'node.completed', node_id: 'output.summary', payload: { message: 'Summary ready', status: 'completed' } },
  ],
  result: {
    summary: {
      tracking_error: 0.0287,
      turnover: 0.0039,
      estimated_tax_cost: 9464,
      estimated_transaction_cost: 430,
      trade_count: 2,
      converged: true,
    },
    trades: [
      { asset_id: '6758.T', name: 'Sony', side: 'sell', shares: 65, notional: 219960 },
      { asset_id: '9433.T', name: 'KDDI', side: 'sell', shares: 243, notional: 640791 },
    ],
    lot_dispositions: [
      { lot_id: 2, asset_id: '6758.T', shares_sold: 65, realized_gain: -55798, tax_liability: 0 },
      { lot_id: 10, asset_id: '9433.T', shares_sold: 243, realized_gain: 46584, tax_liability: 9464 },
    ],
    target_weights: {
      '7203.T': 0.149, '6758.T': 0.079, '8306.T': 0.109,
      '6861.T': 0.090, '9984.T': 0.061, '6501.T': 0.089,
      '7741.T': 0.090, '8035.T': 0.156, '4063.T': 0.101, '9433.T': 0.068,
    },
    portfolio: { currency: 'JPY' },
  },
}

/**
 * Start replaying demo events.
 * Calls onEvent for each event at the recorded timing.
 * Returns a cancel function.
 */
export function startReplay(
  bundle: ReplayBundle,
  onEvent: (event: RunEvent) => void,
  onComplete: (result: ReplayBundle['result']) => void,
  speed: number = 1.0,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []
  let cancelled = false

  for (const event of bundle.events) {
    const timer = setTimeout(() => {
      if (cancelled) return
      onEvent({ ...event, ts: new Date().toISOString() })
    }, event.at_ms / speed)
    timers.push(timer)
  }

  // Complete event after last event + 500ms
  const lastMs = bundle.events[bundle.events.length - 1]?.at_ms || 0
  const completeTimer = setTimeout(() => {
    if (cancelled) return
    onComplete(bundle.result)
  }, (lastMs + 500) / speed)
  timers.push(completeTimer)

  return () => {
    cancelled = true
    timers.forEach(clearTimeout)
  }
}

/**
 * Check URL params for replay mode.
 */
export function getReplayParams(): { replay: string | null; autostart: boolean } {
  const params = new URLSearchParams(window.location.search)
  return {
    replay: params.get('replay'),
    autostart: params.get('autostart') === '1',
  }
}
