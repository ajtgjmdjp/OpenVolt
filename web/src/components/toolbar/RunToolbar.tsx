type Props = {
  onRun: () => void
  runStatus: string
}

export function RunToolbar({ onRun, runStatus }: Props) {
  const isRunning = runStatus === 'running' || runStatus === 'starting'

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onRun}
        disabled={isRunning}
        className={`px-4 py-1.5 rounded text-sm font-medium transition-all ${
          isRunning
            ? 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] cursor-not-allowed'
            : 'bg-[var(--color-accent)] text-black hover:brightness-110 cursor-pointer'
        }`}
      >
        {isRunning ? 'Running...' : '▶ Run Pipeline'}
      </button>
      {runStatus === 'completed' && (
        <span className="text-xs text-[var(--color-success)] mono">COMPLETED</span>
      )}
      {runStatus === 'failed' && (
        <span className="text-xs text-[var(--color-error)] mono">FAILED</span>
      )}
    </div>
  )
}
