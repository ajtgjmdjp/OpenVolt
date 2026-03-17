import { useNavigate } from 'react-router-dom'

type Props = {
  activeView: 'optimize' | 'backtests' | 'experiments'
  rightContent?: React.ReactNode
}

const views = [
  { id: 'optimize' as const, label: 'Optimize', path: '/optimize' },
  { id: 'backtests' as const, label: 'Backtests', path: '/backtests' },
  { id: 'experiments' as const, label: 'Experiments', path: '/experiments' },
] as const

export function NavHeader({ activeView, rightContent }: Props) {
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--color-border)] shrink-0">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-[var(--color-accent)]">⚡ OpenVolt</span>
        </div>

        <nav className="flex items-center gap-1">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => navigate(v.path)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                activeView === v.id
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </div>

      {rightContent}
    </header>
  )
}
