import { useEffect, useRef } from 'react'
import type { RunEvent } from '../../App'

type Props = {
  events: RunEvent[]
}

const typeIcons: Record<string, string> = {
  'run.started': '🚀',
  'run.completed': '✅',
  'run.failed': '❌',
  'node.started': '▶',
  'node.completed': '●',
  'node.failed': '✖',
  'artifact.ready': '📦',
}

export function EventTimeline({ events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive,
  // but only if user is near the bottom (not scrolled up)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events.length])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h3 className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
          Event Stream
          {events.length > 0 && (
            <span className="ml-2 text-[var(--color-border)]">({events.length})</span>
          )}
        </h3>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 pb-3">
        {events.length === 0 ? (
          <p className="text-sm text-[var(--color-text-dim)]">
            Press Run to start the pipeline
          </p>
        ) : (
          <div className="space-y-1.5">
            {events.map((ev) => (
              <div
                key={ev.seq}
                className="flex items-start gap-2 text-xs mono leading-relaxed"
              >
                <span className="shrink-0 w-4 text-center">
                  {typeIcons[ev.type] || '·'}
                </span>
                <span
                  className={
                    ev.type.includes('completed')
                      ? 'text-[var(--color-success)]'
                      : ev.type.includes('failed')
                        ? 'text-[var(--color-error)]'
                        : ev.type.includes('started')
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-dim)]'
                  }
                >
                  {ev.node_id ? `${ev.node_id}` : ev.type}
                </span>
                {'message' in ev.payload && (
                  <span className="text-[var(--color-text-dim)] truncate">
                    {String(ev.payload.message)}
                  </span>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}
