import { useState, useEffect } from 'react'

type Props = {
  itemId: string | null
  filePath: string | null
}

type ArtifactContent = {
  type: 'json' | 'csv' | 'text' | 'unknown'
  raw: string
  parsed?: unknown
}

function parseContent(path: string, raw: string): ArtifactContent {
  const ext = path.split('.').pop()?.toLowerCase() || ''

  if (ext === 'json') {
    try {
      return { type: 'json', raw, parsed: JSON.parse(raw) }
    } catch {
      return { type: 'text', raw }
    }
  }

  if (ext === 'csv') {
    const lines = raw.trim().split('\n')
    const headers = lines[0]?.split(',') || []
    const rows = lines.slice(1).map((line) => line.split(','))
    return { type: 'csv', raw, parsed: { headers, rows } }
  }

  return { type: 'text', raw }
}

function JsonView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) return <span className="text-[var(--color-text-dim)]">null</span>
  if (typeof data === 'boolean') return <span className="text-[var(--color-warning)]">{String(data)}</span>
  if (typeof data === 'number') return <span className="text-[var(--color-accent)]">{data}</span>
  if (typeof data === 'string') return <span className="text-[var(--color-success)]">"{data}"</span>

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-[var(--color-text-dim)]">[]</span>
    if (depth > 3) return <span className="text-[var(--color-text-dim)]">[{data.length} items]</span>
    return (
      <div style={{ paddingLeft: 16 }}>
        {data.map((item, i) => (
          <div key={i} className="flex">
            <span className="text-[var(--color-text-dim)] mr-1 shrink-0">{i}:</span>
            <JsonView data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-[var(--color-text-dim)]">{'{}'}</span>
    if (depth > 3) return <span className="text-[var(--color-text-dim)]">{`{${entries.length} keys}`}</span>
    return (
      <div style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        {entries.map(([key, val]) => (
          <div key={key} className="flex">
            <span className="text-[var(--color-error)] mr-1 shrink-0">"{key}":</span>
            <JsonView data={val} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  return <span>{String(data)}</span>
}

function CsvTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs mono">
        <thead>
          <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
            {headers.map((h, i) => (
              <th key={i} className="text-left py-1.5 px-2 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-2)]/50">
              {row.map((cell, j) => (
                <td key={j} className="py-1 px-2 whitespace-nowrap text-[var(--color-text)]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryCards({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Object.entries(data).map(([key, val]) => {
        const isPercent = key.includes('return') || key.includes('error') || key.includes('turnover') || key.includes('drawdown') || key.includes('volatility')
        const formatted = typeof val === 'number'
          ? isPercent ? `${(val * 100).toFixed(2)}%` : val.toLocaleString()
          : typeof val === 'boolean' ? (val ? '✅ Yes' : '❌ No')
          : String(val)
        return (
          <div key={key} className="bg-[var(--color-surface-2)] rounded-lg p-3">
            <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
              {key.replace(/_/g, ' ')}
            </div>
            <div className="text-lg font-bold mono text-[var(--color-text)]">{formatted}</div>
          </div>
        )
      })}
    </div>
  )
}

function ConfigCards({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([key, val]) => (
        <div key={key} className="flex items-center gap-3 bg-[var(--color-surface-2)] rounded px-3 py-2">
          <span className="text-xs text-[var(--color-text-dim)] w-40 shrink-0">{key.replace(/_/g, ' ')}</span>
          <span className="text-sm mono text-[var(--color-text)]">
            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ArtifactViewer({ itemId, filePath }: Props) {
  const [content, setContent] = useState<ArtifactContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!itemId || !filePath) {
      setContent(null)
      return
    }

    setLoading(true)
    setError(null)

    const url = itemId === '__file__'
      ? `/api/workspace/file/${filePath}`
      : `/api/workspace/items/${itemId}/artifacts/${filePath}`

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data) => {
        setContent(parseContent(filePath, data.content))
        setLoading(false)
      })
      .catch((e) => {
        setError(String(e))
        setLoading(false)
      })
  }, [itemId, filePath])

  if (!itemId && !filePath) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-dim)]">
        <div className="text-center">
          <span className="text-4xl block mb-3">📄</span>
          <p className="text-sm">Select a file from the Explorer to view</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-[var(--color-accent)] animate-pulse">Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <span className="text-[var(--color-error)] text-sm">{error}</span>
        </div>
      </div>
    )
  }

  if (!content) return null

  return (
    <div className="h-full flex flex-col">
      {/* File header + download */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
        <button
          onClick={() => {
            const blob = new Blob([content.raw], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filePath?.split('/').pop() || 'download'
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-accent)] px-2 py-1 rounded border border-[var(--color-border)]"
          title="Download file"
        >
          ⬇ Download
        </button>
      </div>
      <div className="flex items-center gap-2 px-4 py-1 shrink-0">
        <span className="text-xs mono text-[var(--color-text-dim)]">{filePath}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-dim)] uppercase">
          {content.type}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {content.type === 'json' && filePath?.endsWith('summary.json') && content.parsed && typeof content.parsed === 'object' ? (
          <SummaryCards data={content.parsed as Record<string, unknown>} />
        ) : null}
        {content.type === 'json' && filePath?.endsWith('config.json') && content.parsed && typeof content.parsed === 'object' ? (
          <ConfigCards data={content.parsed as Record<string, unknown>} />
        ) : null}
        {content.type === 'json' && !filePath?.endsWith('summary.json') && !filePath?.endsWith('config.json') ? (
          <div className="text-xs mono leading-relaxed">
            <JsonView data={content.parsed} />
          </div>
        ) : null}

        {content.type === 'csv' && content.parsed ? (
          <CsvTable
            headers={(content.parsed as { headers: string[]; rows: string[][] }).headers}
            rows={(content.parsed as { headers: string[]; rows: string[][] }).rows}
          />
        ) : null}

        {content.type === 'text' && (
          <pre className="text-xs mono text-[var(--color-text)] whitespace-pre-wrap">{content.raw}</pre>
        )}
      </div>
    </div>
  )
}
