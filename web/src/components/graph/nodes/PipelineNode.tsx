import { Handle, Position, type NodeProps } from '@xyflow/react'

type PipelineNodeData = {
  label: string
  icon: string
  nodeType: string
  status: 'idle' | 'running' | 'completed' | 'failed'
}

const typeColors: Record<string, string> = {
  dataSource: '#3b82f6',
  aiAgent: '#a855f7',
  riskModel: '#f59e0b',
  optimizer: '#00d4ff',
  output: '#22c55e',
}

const handleStyle = (color: string) => ({
  width: 6,
  height: 6,
  background: color,
  border: 'none',
})

export function PipelineNode({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData
  const color = typeColors[d.nodeType] || '#2a2a3a'
  const isOutput = d.nodeType === 'output'
  const isDataSource = d.nodeType === 'dataSource'

  const statusIndicator =
    d.status === 'running' ? (
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
    ) : d.status === 'completed' ? (
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)]" />
    ) : d.status === 'failed' ? (
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-error)]" />
    ) : (
      <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-border)]" />
    )

  return (
    <div
      className="px-4 py-3 rounded-lg min-w-[160px] transition-all duration-300"
      style={{
        background: '#12121a',
        border: `1px solid ${d.status === 'running' ? color : d.status === 'completed' ? '#22c55e44' : '#2a2a3a'}`,
        boxShadow: d.status === 'running' ? `0 0 20px ${color}33` : 'none',
      }}
    >
      {/* Left handle — hidden for data source nodes (no incoming edges) */}
      {!isDataSource && (
        <Handle type="target" position={Position.Left} style={handleStyle(color)} />
      )}

      <div className="flex items-center gap-2">
        <span className="text-lg">{d.icon}</span>
        <div className="flex flex-col items-start">
          <span className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">
            {d.nodeType === 'dataSource' ? 'Data' :
             d.nodeType === 'aiAgent' ? 'Agent' :
             d.nodeType === 'riskModel' ? 'Risk' :
             d.nodeType === 'optimizer' ? 'Engine' : 'Output'}
          </span>
          <span className="text-sm font-medium text-[var(--color-text)]">{d.label}</span>
        </div>
        <div className="ml-auto">{statusIndicator}</div>
      </div>

      {/* Right handle — hidden for output nodes (no outgoing edges) */}
      {!isOutput && (
        <Handle type="source" position={Position.Right} style={handleStyle(color)} />
      )}
    </div>
  )
}
