import { useState, useEffect, useRef } from 'react'

type Message = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type WorkspaceItem = {
  id: string
  kind: string
  title: string
  summary_json: string | null
  config_json: string | null
}

export function ReportsView() {
  const [items, setItems] = useState<WorkspaceItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'Select workspace artifacts, then ask me to generate a report.' },
  ])
  const [input, setInput] = useState('')
  const [report, setReport] = useState('')
  const [generating, setGenerating] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/workspace/items?limit=50')
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {})
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const generateReport = async () => {
    if (selectedIds.size === 0) {
      setMessages((prev) => [...prev, { role: 'system', content: 'Please select at least one artifact to generate a report.' }])
      return
    }

    setGenerating(true)
    setMessages((prev) => [...prev, { role: 'user', content: input || 'Generate an investment report from the selected artifacts.' }])

    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_ids: Array.from(selectedIds),
          prompt: input || 'Generate a comprehensive investment report.',
        }),
      })
      const data = await res.json()

      setReport(data.report || 'Failed to generate report.')

      const method = data.method === 'ai' ? `AI (${data.model})` : 'Template'
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Generated report via ${method} from ${selectedIds.size} artifact(s).${data.ai_error ? ` (AI fallback: ${data.ai_error})` : ''} See the editor below.`,
      }])
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${String(e)}`,
      }])
    }

    setInput('')
    setGenerating(false)
  }

  const downloadReport = () => {
    const blob = new Blob([report], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `openvolt_report_${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveToWorkspace = async () => {
    const id = `rpt_${Date.now()}`
    await fetch('/api/workspace/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        kind: 'report',
        title: `Report ${new Date().toISOString().slice(0, 10)}`,
        config: { source_artifacts: Array.from(selectedIds) },
        summary: {},
        artifacts: { 'report.md': report },
      }),
    })
    setMessages((prev) => [...prev, { role: 'system', content: `Report saved to workspace as ${id}` }])
  }

  return (
    <div className="flex h-full">
      {/* Left: Artifact selector */}
      <div className="w-64 border-r border-[var(--color-border)] overflow-y-auto p-3 shrink-0 bg-[var(--color-surface)]">
        <h3 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">
          Select Artifacts
        </h3>
        {items.length === 0 ? (
          <p className="text-xs text-[var(--color-text-dim)]">No artifacts yet. Run optimizations first.</p>
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-[var(--color-surface-2)] p-1.5 rounded">
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                  className="accent-[var(--color-accent)] w-3 h-3"
                />
                <span className="shrink-0">
                  {item.kind === 'run' ? '⚡' : item.kind === 'backtest' ? '📈' : '🔬'}
                </span>
                <span className="truncate text-[var(--color-text)]">{item.title}</span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 text-[10px] text-[var(--color-text-dim)]">
          {selectedIds.size} selected
        </div>
      </div>

      {/* Center: Chat (input pinned to bottom) */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-[var(--color-border)]">
        {/* Context banner */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
            <span className="text-[10px] text-[var(--color-text-dim)]">
              Context: {selectedIds.size} artifact{selectedIds.size !== 1 ? 's' : ''} selected
            </span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3 max-w-2xl mx-auto">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-xs ${
                  msg.role === 'user'
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-text)]'
                    : msg.role === 'assistant'
                      ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                      : 'bg-transparent text-[var(--color-text-dim)] italic'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Prompt suggestions when empty */}
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 justify-center mt-8">
              {['Compare the selected backtests', 'Summarize tax impact', 'Write PM-style investment memo', 'Analyze tracking error trends'].map((s) => (
                <button key={s} onClick={() => { setInput(s); }}
                  className="px-3 py-1.5 text-[10px] rounded border border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input pinned to bottom */}
        <div className="p-3 border-t border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 max-w-2xl mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !generating && generateReport()}
              placeholder={selectedIds.size > 0 ? 'Ask about selected artifacts...' : 'Select artifacts first, then ask...'}
              className="flex-1 px-3 py-2 text-xs rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={generateReport}
              disabled={generating}
              className={`px-4 py-2 text-xs rounded-lg font-medium transition-all ${
                generating
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)]'
                  : 'bg-[var(--color-accent)] text-black hover:brightness-110'
              }`}
            >
              {generating ? '...' : '→'}
            </button>
          </div>
        </div>
      </div>

      {/* Right: Report preview/editor */}
      <div className="w-[40%] flex flex-col min-w-0 shrink-0">
        {report ? (
          <>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
              <span className="text-xs text-[var(--color-text-dim)]">Report</span>
              <div className="ml-auto flex gap-2">
                <button onClick={downloadReport}
                  className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)] px-2 py-1 rounded border border-[var(--color-border)]">
                  ⬇ .md
                </button>
                <button onClick={saveToWorkspace}
                  className="text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)] px-2 py-1 rounded border border-[var(--color-border)]">
                  💾 Save
                </button>
              </div>
            </div>
            <textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              className="flex-1 p-4 text-xs mono bg-[var(--color-bg)] text-[var(--color-text)] outline-none resize-none"
              spellCheck={false}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--color-text-dim)]">
            <div className="text-center">
              <span className="text-3xl block mb-3">📝</span>
              <p className="text-xs">Report will appear here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Report generator (client-side MVP)
// In production, this would call an AI API (Claude, GPT, etc.)
// ---------------------------------------------------------------------------

export function generateMarkdownReport(artifacts: Record<string, unknown>[], userPrompt: string): string {
  const now = new Date().toISOString().slice(0, 10)
  const lines: string[] = []

  lines.push(`# OpenVolt Investment Report`)
  lines.push(``)
  lines.push(`**Generated:** ${now}`)
  lines.push(`**Artifacts:** ${artifacts.length}`)
  if (userPrompt) lines.push(`**Request:** ${userPrompt}`)
  lines.push(``)
  lines.push(`---`)
  lines.push(``)

  for (const art of artifacts) {
    const title = String(art.title || 'Untitled')
    const kind = String(art.kind || 'unknown')
    const summary = art.summary as Record<string, unknown> | null
    const config = art.config as Record<string, unknown> | null

    lines.push(`## ${title}`)
    lines.push(``)
    lines.push(`**Type:** ${kind}`)
    if (config) {
      lines.push(`**Configuration:**`)
      for (const [k, v] of Object.entries(config)) {
        lines.push(`- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      }
    }
    lines.push(``)

    if (summary) {
      lines.push(`### Performance Summary`)
      lines.push(``)
      lines.push(`| Metric | Value |`)
      lines.push(`|---|---|`)
      for (const [k, v] of Object.entries(summary)) {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        let formatted: string
        if (typeof v === 'number') {
          if (k.includes('return') || k.includes('error') || k.includes('turnover') || k.includes('drawdown') || k.includes('volatility')) {
            formatted = `${(v * 100).toFixed(2)}%`
          } else if (k.includes('ratio')) {
            formatted = v.toFixed(4)
          } else {
            formatted = v.toLocaleString()
          }
        } else if (typeof v === 'boolean') {
          formatted = v ? 'Yes' : 'No'
        } else {
          formatted = String(v)
        }
        lines.push(`| ${label} | ${formatted} |`)
      }
      lines.push(``)
    }

    lines.push(`---`)
    lines.push(``)
  }

  lines.push(`## Disclaimer`)
  lines.push(``)
  lines.push(`This report is generated by OpenVolt for informational purposes only. `)
  lines.push(`Tax calculations are estimates and should not be used for official tax filing. `)
  lines.push(`Past performance does not guarantee future results.`)
  lines.push(``)
  lines.push(`*Generated by OpenVolt ⚡ — Professional-grade portfolio optimization engine*`)

  return lines.join('\n')
}
