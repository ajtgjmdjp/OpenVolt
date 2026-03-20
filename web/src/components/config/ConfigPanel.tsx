import { useState } from 'react'

export type OptimizeConfig = {
  preset_id: string
  custom_tickers: string[]  // Empty = use preset default
  num_holdings: number      // 0 = use all from preset
  risk_model: string
  solver: string
  disposal_method: string
  tax_jurisdiction: string
  tax_settlement_model: string   // 'source_withholding' | 'annual_filing' | 'custom'
  fiscal_year_mode: string       // 'jan_dec' | 'apr_mar' | 'oct_sep' | 'custom'
  fiscal_year_start_month: number // 1-12 (used when fiscal_year_mode='custom')
  settlement_delay_months: number // months after period end
  market_indices: string[]   // e.g. ['^N225', '^GSPC'] — empty = auto from preset
  period: string            // '1m','3m','6m','1y','2y','3y','custom'
  date_start: string        // YYYY-MM-DD (used when period='custom')
  date_end: string          // YYYY-MM-DD (used when period='custom')
  rebalance_frequency: string
  lambda_te: number
  lambda_tcost: number
  lambda_tax: number
  max_turnover: number
  cash_buffer: number
  max_weight: number
  tax_rate: number
}

export const DEFAULT_CONFIG: OptimizeConfig = {
  preset_id: 'jp_topix_demo',
  custom_tickers: [],
  num_holdings: 0,
  risk_model: 'sample',
  solver: 'osqp',
  disposal_method: 'specific_id',
  tax_jurisdiction: 'japan',
  tax_settlement_model: 'source_withholding',
  fiscal_year_mode: 'jan_dec',
  fiscal_year_start_month: 1,
  settlement_delay_months: 3,
  market_indices: [],  // empty = auto-detect from preset
  period: '1y',
  date_start: '',
  date_end: '',
  rebalance_frequency: 'weekly',
  lambda_te: 200,
  lambda_tcost: 0,
  lambda_tax: 400,
  max_turnover: 0.15,
  cash_buffer: 1_000_000,
  max_weight: 0.20,
  tax_rate: 0.20315,
}

type Props = {
  config: OptimizeConfig
  onChange: (config: OptimizeConfig) => void
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function NumberInput({ label, value, onChange, step, min, max }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        min={min}
        max={max}
        className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none w-full mono"
      />
    </div>
  )
}

export function ConfigPanel({ config, onChange }: Props) {
  const update = <K extends keyof OptimizeConfig>(key: K, value: OptimizeConfig[K]) => {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">Configuration</span>
      </div>

      {/* Benchmark & Data */}
      <div className="space-y-2">
        <div className="text-[10px] text-[var(--color-accent)] uppercase tracking-wider">Benchmark</div>
        <Select label="Preset" value={config.preset_id}
          options={[
            { value: 'jp_topix_demo', label: 'TOPIX Core30 (10 stocks)' },
            { value: 'jp_nikkei225_30', label: 'Nikkei 225 (Top 30)' },
            { value: 'jp_nikkei225_100', label: 'Nikkei 225 (100 stocks)' },
            { value: 'us_sp500_mega', label: 'S&P 500 Mega Cap (10)' },
            { value: 'us_sp500_tech', label: 'S&P 500 Tech (12)' },
            { value: 'global_diversified', label: 'Global Diversified (10)' },
          ]}
          onChange={(v) => {
            const updates: Partial<OptimizeConfig> = { preset_id: v }
            if (v.startsWith('jp_')) {
              updates.tax_jurisdiction = 'japan'
              updates.tax_rate = 0.20315
              updates.tax_settlement_model = 'source_withholding'
              updates.fiscal_year_mode = 'jan_dec'
              updates.settlement_delay_months = 3
            } else if (v.startsWith('us_')) {
              updates.tax_jurisdiction = 'us'
              updates.tax_rate = 0.37
              updates.tax_settlement_model = 'annual_filing'
              updates.fiscal_year_mode = 'jan_dec'
              updates.settlement_delay_months = 4
            }
            onChange({ ...config, ...updates })
          }} />
        <UniverseEditor config={config} onChange={onChange} />
        <Select label="Period" value={config.period}
          options={[
            { value: '1m', label: '1 Month' }, { value: '3m', label: '3 Months' },
            { value: '6m', label: '6 Months' }, { value: '1y', label: '1 Year' },
            { value: '2y', label: '2 Years' }, { value: '3y', label: '3 Years' },
            { value: 'custom', label: 'Custom Range' },
          ]}
          onChange={(v) => update('period', v)} />
        {config.period === 'custom' && (
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Start (YYYY-MM-DD)</label>
              <input type="text" value={config.date_start}
                placeholder="2025-01-01"
                onChange={(e) => update('date_start', e.target.value)}
                className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none mono" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">End (YYYY-MM-DD)</label>
              <input type="text" value={config.date_end}
                placeholder="2026-03-17"
                onChange={(e) => update('date_end', e.target.value)}
                className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none mono" />
            </div>
          </div>
        )}
        {config.period !== 'custom' && (
          <div className="text-[10px] text-[var(--color-text-dim)]">
            Data from {(() => {
              const now = new Date()
              const months: Record<string, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24, '3y': 36 }
              const m = months[config.period] || 12
              const start = new Date(now.getFullYear(), now.getMonth() - m, now.getDate())
              return `${start.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)}`
            })()}
          </div>
        )}
        <Select label="Rebalance" value={config.rebalance_frequency}
          options={[
            { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
          onChange={(v) => update('rebalance_frequency', v)} />
        <MarketIndexEditor config={config} onChange={onChange} />
      </div>

      {/* Model */}
      <div className="space-y-2">
        <div className="text-[10px] text-[var(--color-accent)] uppercase tracking-wider">Model</div>
        <Select label="Risk Model" value={config.risk_model}
          options={[
            { value: 'sample', label: 'Sample Covariance' },
            { value: 'ewma', label: 'EWMA' },
            { value: 'shrinkage', label: 'Ledoit-Wolf Shrinkage' },
            { value: 'factor', label: 'Factor Model' },
          ]}
          onChange={(v) => update('risk_model', v)} />
        <Select label="Solver" value={config.solver || 'osqp'}
          options={[
            { value: 'osqp', label: 'OSQP (default)' },
            { value: 'scs', label: 'SCS (Conic)' },
          ]}
          onChange={(v) => update('solver', v)} />
        <Select label="Tax Jurisdiction" value={config.tax_jurisdiction}
          options={[
            { value: 'japan', label: 'Japan (20.315%)' },
            { value: 'us', label: 'US (37% ST / 20% LT)' },
          ]}
          onChange={(v) => {
            const updates: Partial<OptimizeConfig> = { tax_jurisdiction: v }
            if (v === 'japan') {
              updates.tax_rate = 0.20315
              updates.tax_settlement_model = 'source_withholding'
              updates.fiscal_year_mode = 'jan_dec'
              updates.settlement_delay_months = 3
            } else if (v === 'us') {
              updates.tax_rate = 0.37
              updates.tax_settlement_model = 'annual_filing'
              updates.fiscal_year_mode = 'jan_dec'
              updates.settlement_delay_months = 4
            }
            onChange({ ...config, ...updates })
          }} />
        <Select label="Tax Settlement" value={config.tax_settlement_model}
          options={[
            { value: 'source_withholding', label: 'Source Withholding (売買時控除)' },
            { value: 'annual_filing', label: 'Annual Filing (年次申告)' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => update('tax_settlement_model', v)} />
        <Select label="Fiscal Year" value={config.fiscal_year_mode}
          options={[
            { value: 'jan_dec', label: 'Jan - Dec' },
            { value: 'apr_mar', label: 'Apr - Mar' },
            { value: 'oct_sep', label: 'Oct - Sep' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => update('fiscal_year_mode', v)} />
        {config.fiscal_year_mode === 'custom' && (
          <NumberInput label="FY Start Month (1-12)" value={config.fiscal_year_start_month}
            onChange={(v) => update('fiscal_year_start_month', v)} min={1} max={12} step={1} />
        )}
        <NumberInput label="Settlement Delay (months)" value={config.settlement_delay_months}
          onChange={(v) => update('settlement_delay_months', v)} min={0} max={12} step={1} />
        <Select label="Lot Disposal" value={config.disposal_method}
          options={[
            { value: 'specific_id', label: 'Tax Optimal (Specific ID)' },
            { value: 'fifo', label: 'FIFO' },
            { value: 'lifo', label: 'LIFO' },
          ]}
          onChange={(v) => update('disposal_method', v)} />
      </div>

      {/* Objective */}
      <div className="space-y-2">
        <div className="text-[10px] text-[var(--color-accent)] uppercase tracking-wider">Objective Weights</div>
        <NumberInput label="λ Tracking Error" value={config.lambda_te}
          onChange={(v) => update('lambda_te', v)} step={10} min={0} />
        <NumberInput label="λ Transaction Cost" value={config.lambda_tcost}
          onChange={(v) => update('lambda_tcost', v)} step={0.1} min={0} />
        <NumberInput label="λ Tax Cost" value={config.lambda_tax}
          onChange={(v) => update('lambda_tax', v)} step={10} min={0} />
      </div>

      {/* Constraints */}
      <div className="space-y-2">
        <div className="text-[10px] text-[var(--color-accent)] uppercase tracking-wider">Constraints</div>
        <NumberInput label="Max Turnover" value={config.max_turnover}
          onChange={(v) => update('max_turnover', v)} step={0.01} min={0} max={1} />
        <NumberInput label="Max Weight" value={config.max_weight}
          onChange={(v) => update('max_weight', v)} step={0.01} min={0} max={1} />
        <NumberInput label="Cash Buffer" value={config.cash_buffer}
          onChange={(v) => update('cash_buffer', v)} step={100000} min={0} />
      </div>
    </div>
  )
}

import { COMMON_INDICES } from '../../lib/commonIndices'

function MarketIndexEditor({ config, onChange }: { config: OptimizeConfig; onChange: (c: OptimizeConfig) => void }) {
  const [customInput, setCustomInput] = useState('')
  const selected = config.market_indices || []

  const toggle = (symbol: string) => {
    const next = selected.includes(symbol)
      ? selected.filter((s) => s !== symbol)
      : [...selected, symbol]
    onChange({ ...config, market_indices: next })
  }

  const addCustom = () => {
    const sym = customInput.trim().toUpperCase()
    if (sym && !selected.includes(sym)) {
      onChange({ ...config, market_indices: [...selected, sym] })
    }
    setCustomInput('')
  }

  return (
    <div className="space-y-1.5 min-w-0">
      <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">
        Market Index Overlay {selected.length > 0 ? `(${selected.length})` : '(auto)'}
      </label>
      <div className="flex flex-wrap gap-1 min-w-0">
        {COMMON_INDICES.map((idx) => (
          <button
            key={idx.symbol}
            onClick={() => toggle(idx.symbol)}
            className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
              selected.includes(idx.symbol)
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
            }`}
          >
            {idx.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          placeholder="Custom symbol..."
          className="px-2 py-1 text-[10px] rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none flex-1 mono"
        />
        <button
          onClick={addCustom}
          className="px-2 py-1 text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
        >+</button>
      </div>
      {selected.length > 0 && (
        <button
          onClick={() => onChange({ ...config, market_indices: [] })}
          className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-error)]"
        >Reset to auto</button>
      )}
    </div>
  )
}

// Preset stock counts (keep in sync with backend presets.py)
const PRESET_COUNTS: Record<string, number> = {
  jp_topix_demo: 10, jp_nikkei225_30: 30, jp_nikkei225_100: 100,
  us_sp500_mega: 10, us_sp500_tech: 12, global_diversified: 10,
}

function UniverseEditor({ config, onChange }: { config: OptimizeConfig; onChange: (c: OptimizeConfig) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [tickerInput, setTickerInput] = useState('')

  const presetCount = PRESET_COUNTS[config.preset_id] || 0
  const customCount = config.custom_tickers.length
  const effectiveCount = customCount > 0 ? customCount : (config.num_holdings > 0 ? config.num_holdings : presetCount)

  const addTicker = () => {
    const ticker = tickerInput.trim().toUpperCase()
    if (ticker && !config.custom_tickers.includes(ticker)) {
      onChange({ ...config, custom_tickers: [...config.custom_tickers, ticker] })
    }
    setTickerInput('')
  }

  const removeTicker = (t: string) => {
    onChange({ ...config, custom_tickers: config.custom_tickers.filter((x) => x !== t) })
  }

  // Preview chips
  const previewTickers = config.custom_tickers.slice(0, 3)
  const moreCount = config.custom_tickers.length - 3

  return (
    <div className="space-y-1.5">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div>
          <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Universe</div>
          <div className="text-xs text-[var(--color-text)]">
            {effectiveCount} stocks
            {config.custom_tickers.length > 0 && ' (custom)'}
          </div>
        </div>
        <span className="text-[var(--color-text-dim)] text-sm">{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Preview chips when collapsed */}
      {!expanded && config.custom_tickers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {previewTickers.map((t) => (
            <span key={t} className="px-1.5 py-0.5 text-[10px] mono bg-[var(--color-surface-2)] rounded text-[var(--color-text-dim)]">{t}</span>
          ))}
          {moreCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] mono text-[var(--color-text-dim)]">+{moreCount}</span>
          )}
        </div>
      )}

      {/* Expanded editor */}
      {expanded && (
        <div className="space-y-2 pt-1">
          {/* Target holdings */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Target Holdings</label>
            <div className="flex gap-1">
              <input
                type="number"
                value={config.num_holdings || ''}
                onChange={(e) => onChange({ ...config, num_holdings: Number(e.target.value) || 0 })}
                placeholder={`${presetCount} (preset default)`}
                className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none flex-1 mono"
                min={0}
              />
              {config.num_holdings > 0 && (
                <button
                  onClick={() => onChange({ ...config, num_holdings: 0 })}
                  className="px-2 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                >Reset</button>
              )}
            </div>
            <span className="text-[10px] text-[var(--color-text-dim)]">
              0 = use all from preset ({presetCount})
            </span>
          </div>

          {/* Custom tickers */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Custom Tickers</label>
            <div className="flex gap-1">
              <input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTicker()}
                placeholder="Add ticker..."
                className="px-2 py-1 text-xs rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none flex-1 mono"
              />
              <button
                onClick={addTicker}
                className="px-2 py-1 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              >+</button>
            </div>
          </div>

          {/* Ticker chips */}
          {config.custom_tickers.length > 0 && (
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {config.custom_tickers.map((t) => (
                <span key={t} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] mono bg-[var(--color-surface-2)] rounded">
                  <span className="text-[var(--color-text)]">{t}</span>
                  <button
                    onClick={() => removeTicker(t)}
                    className="text-[var(--color-text-dim)] hover:text-[var(--color-error)]"
                  >×</button>
                </span>
              ))}
            </div>
          )}

          {config.custom_tickers.length > 0 && (
            <button
              onClick={() => onChange({ ...config, custom_tickers: [] })}
              className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-error)]"
            >Clear all custom tickers</button>
          )}
        </div>
      )}
    </div>
  )
}
