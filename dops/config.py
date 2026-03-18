from __future__ import annotations

import os
from pathlib import Path

DEFAULT_SKILL_NAME = os.environ.get("SKILL_NAME", "decision-ops")
DEFAULT_MCP_SERVER_NAME = os.environ.get("MCP_SERVER_NAME", "decision-ops-mcp")
DEFAULT_MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "https://api.aidecisionops.com/mcp")
DEFAULT_API_BASE_URL = os.environ.get("DECISIONOPS_API_BASE_URL", "https://api.aidecisionops.com")
DEFAULT_OAUTH_ISSUER_URL = "https://auth.aidecisionops.com/oauth"
DEFAULT_OAUTH_CLIENT_ID = "decisionops-cli"
DEFAULT_OAUTH_SCOPES = [
    "decisions:read",
    "decisions:write",
    "decisions:approve",
    "metrics:read",
    "admin:read",
]
DEFAULT_OAUTH_API_AUDIENCE = "https://api.aidecisionops.com/v1"
PLACEHOLDER_ORG_ID = "org_123"
PLACEHOLDER_PROJECT_ID = "proj_456"
PLACEHOLDER_REPO_REF = "owner/repo"


def expand_home(value: str) -> str:
    if not value.startswith("~"):
        return value
    return str(Path(value).expanduser())


def decisionops_home() -> str:
    return expand_home(os.environ.get("DECISIONOPS_HOME", "~/.decisionops"))
