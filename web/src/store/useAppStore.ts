/**
 * Global application store (Zustand).
 * Persists state across view switches.
 * Central workspace for all views + cross-view data reuse.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RunEvent, NodeStatusMap, RunResult } from '../App'
import { type OptimizeConfig, DEFAULT_CONFIG } from '../components/config/ConfigPanel'

// ---------------------------------------------------------------------------
// Saved result types (shared across views)
// ---------------------------------------------------------------------------

export type SavedRun = {
  id: string
  label: string
  source: 'optimize' | 'backtest' | 'experiment'
  config: OptimizeConfig
  result: RunResult
  events: RunEvent[]
  timestamp: number
}

export type BacktestData = {
  summary: Record<string, unknown>
  daily: Array<Record<string, unknown>>
}

export type ExperimentData = {
  mode: 'sweep' | 'montecarlo'
  runs: Array<Record<string, unknown>>
  aggregate?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type AppState = {
  // Config (shared across views)
  config: OptimizeConfig
  setConfig: (config: OptimizeConfig) => void

  // Optimize view state
  optimizeRunStatus: string
  optimizeNodeStatuses: NodeStatusMap
  optimizeEvents: RunEvent[]
  optimizeResult: RunResult
  optimizeSelectedNode: string | null
  setOptimizeState: (state: Partial<Pick<AppState,
    'optimizeRunStatus' | 'optimizeNodeStatuses' | 'optimizeEvents' | 'optimizeResult' | 'optimizeSelectedNode'
  >>) => void

  // Run history (tabs — shared across views)
  savedRuns: SavedRun[]
  activeRunId: string | null
  saveRun: (run: SavedRun) => void
  setActiveRun: (id: string | null) => void
  removeRun: (id: string) => void

  // Backtests view state (preserved across nav)
  backtestResult: BacktestData | null
  backtestStatus: string
  backtestError: string | null
  backtestConfig: OptimizeConfig  // Separate config snapshot for backtest
  setBacktestState: (state: Partial<Pick<AppState,
    'backtestResult' | 'backtestStatus' | 'backtestError' | 'backtestConfig'
  >>) => void
  // Saved backtests for cross-view reuse
  savedBacktests: Array<{ id: string; label: string; config: OptimizeConfig; result: BacktestData; timestamp: number }>
  saveBacktest: (bt: { id: string; label: string; config: OptimizeConfig; result: BacktestData }) => void

  // Experiments view state (preserved across nav)
  experimentResult: ExperimentData | null
  experimentStatus: string
  experimentMode: 'sweep' | 'montecarlo'
  setExperimentState: (state: Partial<Pick<AppState,
    'experimentResult' | 'experimentStatus' | 'experimentMode'
  >>) => void

  // Dashboard chart visibility (BI-style)
  visibleCharts: string[]
  setVisibleCharts: (charts: string[]) => void
  toggleChart: (chart: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  // Config
  config: DEFAULT_CONFIG,
  setConfig: (config) => set({ config }),

  // Optimize
  optimizeRunStatus: 'idle',
  optimizeNodeStatuses: {},
  optimizeEvents: [],
  optimizeResult: null,
  optimizeSelectedNode: null,
  setOptimizeState: (state) => set(state),

  // Run history
  savedRuns: [],
  activeRunId: null,
  saveRun: (run) => set((s) => ({
    savedRuns: [...s.savedRuns, run],
    activeRunId: run.id,
  })),
  setActiveRun: (id) => set({ activeRunId: id }),
  removeRun: (id) => set((s) => ({
    savedRuns: s.savedRuns.filter((r) => r.id !== id),
    activeRunId: s.activeRunId === id ? null : s.activeRunId,
  })),

  // Backtests
  backtestResult: null,
  backtestStatus: 'idle',
  backtestError: null,
  backtestConfig: DEFAULT_CONFIG,
  setBacktestState: (state) => set(state),
  savedBacktests: [],
  saveBacktest: (bt) => set((s) => ({
    savedBacktests: [...s.savedBacktests, { ...bt, timestamp: Date.now() }],
  })),

  // Experiments
  experimentResult: null,
  experimentStatus: 'idle',
  experimentMode: 'sweep',
  setExperimentState: (state) => set(state),

  // Dashboard charts
  visibleCharts: ['Drawdown', 'Rolling TE'],
  setVisibleCharts: (charts) => set({ visibleCharts: charts }),
  toggleChart: (chart) => set((s) => ({
    visibleCharts: s.visibleCharts.includes(chart)
      ? s.visibleCharts.filter((c) => c !== chart)
      : [...s.visibleCharts, chart],
  })),
}),
    {
      name: 'openvolt-store',
      storage: {
        getItem: (name) => {
          const str = sessionStorage.getItem(name)
          return str ? JSON.parse(str) : null
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value))
        },
        removeItem: (name) => sessionStorage.removeItem(name),
      },
      // Only persist lightweight state, not large data arrays
      partialize: (state) => ({
        config: state.config,
        backtestConfig: state.backtestConfig,
        visibleCharts: state.visibleCharts,
        experimentMode: state.experimentMode,
      }),
    }
  )
)
