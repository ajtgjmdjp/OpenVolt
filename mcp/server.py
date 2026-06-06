"""OpenVolt MCP Server — exposes portfolio optimization to AI agents."""

import json
import logging
import sys
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# Defaults for the plan_rebalance tool. Mirror the Python and FastAPI
# entry points so AI agents and HTTP clients see the same risk/tax knobs.
DEFAULT_LAMBDA_TE = 200.0
DEFAULT_LAMBDA_TAX = 400.0
DEFAULT_MAX_TURNOVER = 0.15
DEFAULT_TAX_RATE = 0.20315  # Japan 特定口座
DEFAULT_PER_NAME_CAP = 0.20
DEFAULT_TCOST_BPS = 5.0
DEFAULT_MIN_TRADE_NOTIONAL = 10_000
DEFAULT_WORKSPACE_LIST_LIMIT = 20
TARGET_WEIGHT_DECIMALS = 6

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_BUILD_DIR = _PROJECT_ROOT / "build"
# Add build dir (for _openvolt) and project root (for `api.app.*`) once at
# import time instead of inside every handler.
for _p in (_BUILD_DIR, _PROJECT_ROOT):
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
    HAS_MCP = True
except ImportError:
    HAS_MCP = False

import numpy as np

try:
    import _openvolt as ov
    HAS_ENGINE = True
except ImportError:
    HAS_ENGINE = False


def _workspace_store():
    """Return a WorkspaceStore handle, importing lazily on first use."""
    from api.app.services.workspace.store import WorkspaceStore

    return WorkspaceStore("workspace")


def create_server() -> "Server":
    server = Server("openvolt")

    @server.list_tools()
    async def list_tools():
        return [
            Tool(
                name="plan_rebalance",
                description=(
                    "Optimize a portfolio rebalance. Given current holdings (tax lots), "
                    "benchmark weights, prices, and a covariance matrix, compute the optimal "
                    "trade list that minimizes tracking error + transaction cost + tax cost. "
                    "Returns trades, tax lot dispositions, and diagnostics."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "as_of": {
                            "type": "string",
                            "description": "Date in YYYY-MM-DD format",
                        },
                        "cash": {
                            "type": "number",
                            "description": "Available cash in portfolio",
                        },
                        "lots": {
                            "type": "array",
                            "description": "Tax lots: [{lot_id, asset_id, shares, cost_basis_per_share, acquired_on}]",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "lot_id": {"type": "integer"},
                                    "asset_id": {"type": "string"},
                                    "shares": {"type": "number"},
                                    "cost_basis_per_share": {"type": "number"},
                                    "acquired_on": {"type": "string"},
                                },
                                "required": ["lot_id", "asset_id", "shares", "cost_basis_per_share", "acquired_on"],
                            },
                        },
                        "asset_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Universe of asset IDs",
                        },
                        "prices": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "Current prices (same order as asset_ids)",
                        },
                        "benchmark_weights": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "Target benchmark weights (same order as asset_ids)",
                        },
                        "covariance": {
                            "type": "array",
                            "items": {"type": "array", "items": {"type": "number"}},
                            "description": "N x N covariance matrix (annualized)",
                        },
                        "lambda_te": {
                            "type": "number",
                            "description": "Tracking error penalty weight (default: 200)",
                            "default": 200.0,
                        },
                        "lambda_tax": {
                            "type": "number",
                            "description": "Tax cost penalty weight (default: 400)",
                            "default": 400.0,
                        },
                        "tax_rate": {
                            "type": "number",
                            "description": "Tax rate (default: 0.20315 for Japan)",
                            "default": 0.20315,
                        },
                        "max_turnover": {
                            "type": "number",
                            "description": "Maximum one-way turnover (default: 0.15)",
                            "default": 0.15,
                        },
                    },
                    "required": ["as_of", "cash", "lots", "asset_ids", "prices", "benchmark_weights", "covariance"],
                },
            ),
            Tool(
                name="list_workspace",
                description="List saved items in the OpenVolt workspace (runs, backtests, experiments, reports).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "description": "Filter by kind: run, backtest, experiment, report, config"},
                        "limit": {"type": "integer", "description": "Max items to return", "default": 20},
                    },
                },
            ),
            Tool(
                name="read_artifact",
                description="Read a specific artifact file from a workspace item (config.json, summary.json, trades.csv, etc.)",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "item_id": {"type": "string", "description": "Workspace item ID"},
                        "artifact_name": {"type": "string", "description": "Artifact filename (e.g., config.json, summary.json, trades.csv)"},
                    },
                    "required": ["item_id", "artifact_name"],
                },
            ),
            Tool(
                name="save_report",
                description="Save a markdown report to the OpenVolt workspace.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Report title"},
                        "content": {"type": "string", "description": "Markdown report content"},
                        "source_artifact_ids": {"type": "array", "items": {"type": "string"}, "description": "IDs of artifacts used to generate this report"},
                    },
                    "required": ["title", "content"],
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):
        # Workspace tools
        if name == "list_workspace":
            try:
                items = _workspace_store().list_items(
                    kind=arguments.get("kind"),
                    limit=arguments.get("limit", DEFAULT_WORKSPACE_LIST_LIMIT),
                )
                return [TextContent(type="text", text=json.dumps(items, indent=2, default=str))]
            except Exception as e:
                logger.exception("list_workspace failed")
                return [TextContent(type="text", text=f"Error: {e}")]

        if name == "read_artifact":
            try:
                content = _workspace_store().get_artifact(
                    arguments["item_id"], arguments["artifact_name"]
                )
                if content is None:
                    return [TextContent(type="text", text=f"Artifact not found: {arguments['artifact_name']}")]
                return [TextContent(type="text", text=content)]
            except Exception as e:
                logger.exception("read_artifact failed")
                return [TextContent(type="text", text=f"Error: {e}")]

        if name == "save_report":
            try:
                report_id = f"rpt_{int(time.time())}"
                _workspace_store().save_item(
                    id=report_id,
                    kind="report",
                    title=arguments["title"],
                    config={"source_artifacts": arguments.get("source_artifact_ids", [])},
                    summary={},
                    artifacts={"report.md": arguments["content"]},
                )
                return [TextContent(type="text", text=f"Report saved as {report_id}")]
            except Exception as e:
                logger.exception("save_report failed")
                return [TextContent(type="text", text=f"Error: {e}")]

        # Optimization tool
        if name != "plan_rebalance":
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

        if not HAS_ENGINE:
            return [TextContent(type="text", text="Error: OpenVolt C++ engine not available. Build first.")]

        try:
            # Parse inputs
            as_of = arguments["as_of"]
            cash = float(arguments["cash"])
            asset_ids = arguments["asset_ids"]
            N = len(asset_ids)

            # Tax lots
            lots = []
            for lot_data in arguments["lots"]:
                lots.append(ov.TaxLot(
                    lot_id=int(lot_data["lot_id"]),
                    asset_id=str(lot_data["asset_id"]),
                    shares=float(lot_data["shares"]),
                    cost_basis_per_share=float(lot_data["cost_basis_per_share"]),
                    acquired_on=str(lot_data["acquired_on"]),
                ))

            portfolio = ov.PortfolioState(as_of=as_of, cash=cash, lots=lots)

            # Covariance
            cov_data = arguments["covariance"]
            cov = np.array(cov_data, dtype=float)

            risk = ov.FullCovarianceRisk(asset_ids=asset_ids, covariance=cov)

            prices = np.array(arguments["prices"], dtype=float)
            bench_w = np.array(arguments["benchmark_weights"], dtype=float)
            tcost_bps = np.full(N, DEFAULT_TCOST_BPS)

            market = ov.MarketData(
                as_of=as_of,
                asset_ids=asset_ids,
                prices=prices,
                benchmark_weights=bench_w,
                transaction_cost_bps=tcost_bps,
                risk_model=risk,
            )

            # Config
            tax_rate = float(arguments.get("tax_rate", DEFAULT_TAX_RATE))
            config = ov.OptimizationConfig()
            config.objective.tracking_error = float(arguments.get("lambda_te", DEFAULT_LAMBDA_TE))
            config.objective.transaction_cost = 0.0
            config.objective.tax_cost = float(arguments.get("lambda_tax", DEFAULT_LAMBDA_TAX))
            config.constraints.max_turnover = float(
                arguments.get("max_turnover", DEFAULT_MAX_TURNOVER)
            )
            config.taxes.short_term_rate = tax_rate
            config.taxes.long_term_rate = tax_rate
            config.taxes.wash_sale_window_days = None
            config.taxes.disposal_method = ov.DisposalMethod.specific_id
            config.min_trade_notional = DEFAULT_MIN_TRADE_NOTIONAL
            config.round_to_whole_shares = True

            for aid in asset_ids:
                config.constraints.weight_bounds[aid] = ov.WeightBound(0.0, DEFAULT_PER_NAME_CAP)

            # Run optimization
            result = ov.plan_rebalance(ov.RebalanceRequest(portfolio, market, config))

            # Format response
            response = {
                "converged": result.diagnostics.converged,
                "tracking_error": f"{result.diagnostics.ex_ante_tracking_error:.4f}",
                "turnover": f"{result.diagnostics.turnover:.4f}",
                "estimated_tax_cost": round(result.diagnostics.estimated_tax_cost),
                "trades": [
                    {
                        "asset_id": t.asset_id,
                        "side": "buy" if t.side == ov.Side.buy else "sell",
                        "shares": round(t.shares),
                        "notional": round(t.notional),
                    }
                    for t in result.trades
                ],
                "lot_dispositions": [
                    {
                        "lot_id": d.lot_id,
                        "asset_id": d.asset_id,
                        "shares_sold": round(d.shares_sold),
                        "realized_gain": round(d.realized_gain),
                        "tax_liability": round(d.tax_liability),
                    }
                    for d in result.lot_dispositions
                ],
                "target_weights": {
                    asset_ids[i]: round(result.target_weights[i], TARGET_WEIGHT_DECIMALS)
                    for i in range(N)
                },
            }

            return [TextContent(type="text", text=json.dumps(response, indent=2))]

        except Exception as e:
            logger.exception("plan_rebalance failed")
            return [TextContent(type="text", text=f"Error: {e}")]

    return server


async def main():
    if not HAS_MCP:
        print("Error: mcp package not installed. Run: pip install mcp", file=sys.stderr)
        sys.exit(1)

    server = create_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(main())
