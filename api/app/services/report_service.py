"""AI-powered report generation service.

Supports multiple AI backends:
- Gemini API (via OpenAI-compatible endpoint)
- Any OpenAI-compatible API

Falls back to template-based generation if no API key is configured.
"""

from __future__ import annotations

import json
import os
from typing import Optional

from .workspace.store import WorkspaceStore


def generate_report(
    artifact_ids: list[str],
    user_prompt: str = "",
    model: str = "gemini-2.0-flash",
    workspace_dir: str = "workspace",
) -> dict:
    """Generate an AI-powered investment report from workspace artifacts.

    Returns:
        {"report": "markdown string", "model": "model used", "method": "ai" | "template"}
    """
    ws = WorkspaceStore(workspace_dir)

    # Gather artifact data
    artifacts = []
    for aid in artifact_ids:
        item = ws.get_item(aid)
        if not item:
            continue

        artifact_data = {
            "id": item["id"],
            "kind": item["kind"],
            "title": item["title"],
            "created_at": item["created_at"],
        }

        if item.get("config_json"):
            artifact_data["config"] = json.loads(item["config_json"])
        if item.get("summary_json"):
            artifact_data["summary"] = json.loads(item["summary_json"])

        # Try to read trades
        trades_content = ws.get_artifact(aid, "trades.csv")
        if trades_content:
            artifact_data["trades_csv"] = trades_content[:2000]  # Truncate for prompt

        artifacts.append(artifact_data)

    if not artifacts:
        return {"report": "No artifacts found.", "model": "none", "method": "error"}

    # Try AI generation
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("OPENAI_API_KEY")

    if api_key:
        try:
            return _generate_with_ai(artifacts, user_prompt, model, api_key)
        except Exception as e:
            # Fall back to template
            return {
                "report": _generate_template(artifacts, user_prompt),
                "model": "template",
                "method": "template",
                "ai_error": str(e),
            }

    # No API key — use template
    return {
        "report": _generate_template(artifacts, user_prompt),
        "model": "template",
        "method": "template",
    }


def _generate_with_ai(
    artifacts: list[dict],
    user_prompt: str,
    model: str,
    api_key: str,
) -> dict:
    """Generate report using AI API (OpenAI-compatible)."""

    # Determine base URL
    if "GOOGLE_API_KEY" in os.environ:
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai"
    else:
        base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")

    # Use requests directly (no dependency on openai package)
    import requests

    system_prompt = """You are a professional investment analyst writing a report for OpenVolt,
a portfolio optimization platform. You receive structured data about portfolio optimization
results and should produce a clear, professional investment report in markdown.

Include:
- Executive summary
- Portfolio performance analysis
- Risk assessment (tracking error, drawdown)
- Tax efficiency analysis (realized gains/losses, TLH impact)
- Trade recommendations
- Key observations and concerns
- Disclaimer

Use the data provided. Do not invent numbers. Be precise with the values given.
Format as clean markdown with headers, tables, and bullet points."""

    data_context = json.dumps(artifacts, indent=2, default=str)

    user_message = f"""Generate an investment report from the following portfolio optimization data:

{data_context}

{f'Additional instructions: {user_prompt}' if user_prompt else ''}"""

    response = requests.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "max_tokens": 4000,
            "temperature": 0.3,
        },
        timeout=60,
    )

    if response.status_code != 200:
        raise RuntimeError(f"AI API error: {response.status_code} {response.text[:200]}")

    result = response.json()
    content = result["choices"][0]["message"]["content"]

    return {
        "report": content,
        "model": model,
        "method": "ai",
    }


def _generate_template(artifacts: list[dict], user_prompt: str) -> str:
    """Template-based report (no AI)."""
    from datetime import datetime

    lines = [
        "# OpenVolt Investment Report",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"**Artifacts:** {len(artifacts)}",
        f"**Method:** Template (no AI API configured)",
    ]

    if user_prompt:
        lines.append(f"**Request:** {user_prompt}")
    lines.extend(["", "---", ""])

    for art in artifacts:
        lines.append(f"## {art.get('title', 'Untitled')}")
        lines.append(f"**Type:** {art.get('kind', 'unknown')}")
        lines.append("")

        config = art.get("config", {})
        if config:
            lines.append("### Configuration")
            for k, v in config.items():
                lines.append(f"- **{k}:** {v}")
            lines.append("")

        summary = art.get("summary", {})
        if summary:
            lines.append("### Performance")
            lines.append("| Metric | Value |")
            lines.append("|---|---|")
            for k, v in summary.items():
                label = k.replace("_", " ").title()
                if isinstance(v, float):
                    if any(x in k for x in ["return", "error", "turnover", "drawdown", "volatility"]):
                        formatted = f"{v*100:.2f}%"
                    elif "ratio" in k:
                        formatted = f"{v:.4f}"
                    else:
                        formatted = f"{v:,.0f}"
                elif isinstance(v, bool):
                    formatted = "Yes" if v else "No"
                else:
                    formatted = str(v)
                lines.append(f"| {label} | {formatted} |")
            lines.append("")

        lines.extend(["---", ""])

    lines.extend([
        "## Disclaimer",
        "",
        "This report is for informational purposes only. Tax calculations are estimates.",
        "Past performance does not guarantee future results.",
        "",
        "*Generated by OpenVolt ⚡*",
    ])

    return "\n".join(lines)
