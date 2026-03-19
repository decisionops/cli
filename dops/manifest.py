from __future__ import annotations

import json
import tomllib
from pathlib import Path
from typing import Any

from .fileio import atomic_write_text


def _quote(value: str) -> str:
    return json.dumps(value)


def _decisionops_dir(repo_path: str) -> Path:
    return Path(repo_path) / ".decisionops"


def write_manifest(repo_path: str, values: dict[str, str | None]) -> str:
    file_path = _decisionops_dir(repo_path) / "manifest.toml"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "version = 1",
        f"org_id = {_quote(str(values['org_id']))}",
        f"project_id = {_quote(str(values['project_id']))}",
        f"repo_ref = {_quote(str(values['repo_ref']))}",
    ]
    if values.get("repo_id"):
        lines.append(f"repo_id = {_quote(str(values['repo_id']))}")
    lines.extend(
        [
            f"default_branch = {_quote(str(values['default_branch']))}",
            f"mcp_server_name = {_quote(str(values['mcp_server_name']))}",
            f"mcp_server_url = {_quote(str(values['mcp_server_url']))}",
            "",
        ]
    )
    atomic_write_text(file_path, "\n".join(lines), encoding="utf8")
    return str(file_path)


def read_manifest(repo_path: str) -> dict[str, Any] | None:
    file_path = _decisionops_dir(repo_path) / "manifest.toml"
    if not file_path.exists():
        return None
    return tomllib.loads(file_path.read_text(encoding="utf8"))


def write_auth_handoff(repo_path: str | None, output_dir: str, entries: list[dict[str, Any]]) -> str:
    file_path = (
        (_decisionops_dir(repo_path) / "auth-handoff.toml")
        if repo_path
        else (Path(output_dir) / "auth-handoff.toml")
    )
    file_path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["version = 1", ""]
    for entry in entries:
        lines.append("[[platforms]]")
        lines.append(f"id = {_quote(str(entry['id']))}")
        lines.append(f"display_name = {_quote(str(entry['display_name']))}")
        lines.append(f"mode = {_quote(str(entry['mode']))}")
        lines.append(f"platform_definition = {_quote(str(entry['platform_definition']))}")
        lines.append(f"mcp_config_path = {_quote(str(entry['mcp_config_path']))}")
        instructions = ", ".join(_quote(str(item)) for item in entry.get("instructions", []))
        lines.append(f"instructions = [{instructions}]")
        lines.append("")
    atomic_write_text(file_path, "\n".join(lines), encoding="utf8")
    return str(file_path)
