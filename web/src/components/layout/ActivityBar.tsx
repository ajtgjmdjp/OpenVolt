type ActivityItem = {
  id: string
  icon: string
  label: string
}

const activities: ActivityItem[] = [
  { id: 'explorer', icon: '📁', label: 'Explorer' },
  { id: 'studio', icon: '🔬', label: 'Studio' },
  { id: 'compare', icon: '⚖️', label: 'Compare' },
  { id: 'reports', icon: '📄', label: 'Reports' },
]

type Props = {
  active: string
  onChange: (id: string) => void
}

export function ActivityBar({ active, onChange }: Props) {
  return (
    <div className="w-12 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col items-center py-2 gap-1 shrink-0">
      {activities.map((a) => (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          title={a.label}
          className={`w-10 h-10 flex items-center justify-center rounded text-lg transition-colors ${
            active === a.id
              ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]/50'
          }`}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )
}
