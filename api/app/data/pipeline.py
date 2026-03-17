"""Pipeline graph definition — fixed DAG for the MVP."""

PIPELINE_GRAPH = {
    "nodes": [
        # Data sources
        {"id": "source.stockprice", "type": "dataSource", "label": "Stock Prices", "icon": "chart-line",
         "position": {"x": 0, "y": 0}},
        {"id": "source.edinet", "type": "dataSource", "label": "EDINET Filings", "icon": "file-text",
         "position": {"x": 0, "y": 120}},
        {"id": "source.estat", "type": "dataSource", "label": "Macro Stats", "icon": "globe",
         "position": {"x": 0, "y": 240}},
        {"id": "source.tdnet", "type": "dataSource", "label": "Disclosures", "icon": "bell",
         "position": {"x": 0, "y": 360}},

        # AI Agents
        {"id": "agent.researcher", "type": "aiAgent", "label": "Researcher", "icon": "search",
         "position": {"x": 300, "y": 60}},
        {"id": "agent.macro", "type": "aiAgent", "label": "Macro Analyst", "icon": "trending-up",
         "position": {"x": 300, "y": 200}},
        {"id": "agent.verifier", "type": "aiAgent", "label": "Verifier", "icon": "check-circle",
         "position": {"x": 300, "y": 340}},

        # Risk Model
        {"id": "risk.model", "type": "riskModel", "label": "Risk Model", "icon": "shield",
         "position": {"x": 600, "y": 120}},

        # Optimizer
        {"id": "optimizer.main", "type": "optimizer", "label": "Optimizer", "icon": "zap",
         "position": {"x": 600, "y": 300}},

        # Outputs
        {"id": "output.trades", "type": "output", "label": "Trades", "icon": "list",
         "position": {"x": 900, "y": 60}},
        {"id": "output.taxlots", "type": "output", "label": "Tax Lots", "icon": "dollar-sign",
         "position": {"x": 900, "y": 200}},
        {"id": "output.summary", "type": "output", "label": "Summary", "icon": "bar-chart-2",
         "position": {"x": 900, "y": 340}},
    ],
    "edges": [
        # Sources -> Agents
        {"source": "source.stockprice", "target": "agent.researcher"},
        {"source": "source.edinet", "target": "agent.researcher"},
        {"source": "source.estat", "target": "agent.macro"},
        {"source": "source.tdnet", "target": "agent.verifier"},

        # Sources -> Risk Model
        {"source": "source.stockprice", "target": "risk.model"},

        # Agents -> Optimizer
        {"source": "agent.researcher", "target": "optimizer.main"},
        {"source": "agent.macro", "target": "optimizer.main"},
        {"source": "agent.verifier", "target": "optimizer.main"},

        # Risk Model -> Optimizer
        {"source": "risk.model", "target": "optimizer.main"},

        # Optimizer -> Outputs
        {"source": "optimizer.main", "target": "output.trades"},
        {"source": "optimizer.main", "target": "output.taxlots"},
        {"source": "optimizer.main", "target": "output.summary"},
    ],
}
