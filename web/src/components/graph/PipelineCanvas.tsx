import { useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PipelineNode } from './nodes/PipelineNode'
import type { NodeStatusMap } from '../../App'

const nodeTypes = {
  dataSource: PipelineNode,
  aiAgent: PipelineNode,
  riskModel: PipelineNode,
  optimizer: PipelineNode,
  output: PipelineNode,
}

const defaultNodes: Node[] = [
  { id: 'source.stockprice', type: 'dataSource', position: { x: 50, y: 30 },
    data: { label: 'Stock Prices', icon: '📈', nodeType: 'dataSource', status: 'idle' } },
  { id: 'source.edinet', type: 'dataSource', position: { x: 50, y: 150 },
    data: { label: 'EDINET Filings', icon: '📄', nodeType: 'dataSource', status: 'idle' } },
  { id: 'source.estat', type: 'dataSource', position: { x: 50, y: 270 },
    data: { label: 'Macro Stats', icon: '🌐', nodeType: 'dataSource', status: 'idle' } },
  { id: 'source.tdnet', type: 'dataSource', position: { x: 50, y: 390 },
    data: { label: 'Disclosures', icon: '🔔', nodeType: 'dataSource', status: 'idle' } },
  { id: 'agent.researcher', type: 'aiAgent', position: { x: 350, y: 70 },
    data: { label: 'Researcher', icon: '🔍', nodeType: 'aiAgent', status: 'idle' } },
  { id: 'agent.macro', type: 'aiAgent', position: { x: 350, y: 220 },
    data: { label: 'Macro Analyst', icon: '📊', nodeType: 'aiAgent', status: 'idle' } },
  { id: 'agent.verifier', type: 'aiAgent', position: { x: 350, y: 370 },
    data: { label: 'Verifier', icon: '✅', nodeType: 'aiAgent', status: 'idle' } },
  { id: 'risk.model', type: 'riskModel', position: { x: 650, y: 130 },
    data: { label: 'Risk Model', icon: '🛡️', nodeType: 'riskModel', status: 'idle' } },
  { id: 'optimizer.main', type: 'optimizer', position: { x: 650, y: 310 },
    data: { label: 'Optimizer', icon: '⚡', nodeType: 'optimizer', status: 'idle' } },
  { id: 'output.trades', type: 'output', position: { x: 950, y: 70 },
    data: { label: 'Trades', icon: '📋', nodeType: 'output', status: 'idle' } },
  { id: 'output.taxlots', type: 'output', position: { x: 950, y: 220 },
    data: { label: 'Tax Lots', icon: '💰', nodeType: 'output', status: 'idle' } },
  { id: 'output.summary', type: 'output', position: { x: 950, y: 370 },
    data: { label: 'Summary', icon: '📈', nodeType: 'output', status: 'idle' } },
]

const defaultEdges: Edge[] = [
  { id: 'e1', source: 'source.stockprice', target: 'agent.researcher' },
  { id: 'e2', source: 'source.edinet', target: 'agent.researcher' },
  { id: 'e3', source: 'source.estat', target: 'agent.macro' },
  { id: 'e4', source: 'source.tdnet', target: 'agent.verifier' },
  { id: 'e5', source: 'source.stockprice', target: 'risk.model' },
  { id: 'e6', source: 'agent.researcher', target: 'optimizer.main' },
  { id: 'e7', source: 'agent.macro', target: 'optimizer.main' },
  { id: 'e8', source: 'agent.verifier', target: 'optimizer.main' },
  { id: 'e9', source: 'risk.model', target: 'optimizer.main' },
  { id: 'e10', source: 'optimizer.main', target: 'output.trades' },
  { id: 'e11', source: 'optimizer.main', target: 'output.taxlots' },
  { id: 'e12', source: 'optimizer.main', target: 'output.summary' },
]

type Props = {
  nodeStatuses: NodeStatusMap
  onNodeClick?: (nodeId: string) => void
}

export function PipelineCanvas({ nodeStatuses, onNodeClick }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges)

  // Update node data when statuses change
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          status: nodeStatuses[node.id] || 'idle',
        },
      }))
    )
  }, [nodeStatuses, setNodes])

  // Update edge styles when statuses change
  useEffect(() => {
    setEdges((eds) =>
      eds.map((edge) => ({
        ...edge,
        animated: nodeStatuses[edge.target] === 'running',
        style: {
          stroke: nodeStatuses[edge.target] === 'running'
            ? '#00d4ff'
            : nodeStatuses[edge.target] === 'completed'
              ? '#22c55e88'
              : '#4a4a5a',
          strokeWidth: nodeStatuses[edge.target] === 'running' ? 2.5 : 1.5,
        },
      }))
    )
  }, [nodeStatuses, setEdges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      style={{ background: '#0a0a0f' }}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => onNodeClick?.(node.id)}
    >
      <Background color="#1a1a26" gap={20} />
      <Controls
        showInteractive={false}
        style={{
          background: '#0a0a0f',
          border: '1px solid #2a2a3a',
          borderRadius: 8,
          boxShadow: 'none',
        }}
      />
    </ReactFlow>
  )
}
