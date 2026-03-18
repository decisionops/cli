from __future__ import annotations

import sys
from typing import Any

from rich.panel import Panel

from ..api_client import DopsClient, load_user_context
from ..auth import AuthState, write_auth_state
from ..config import DEFAULT_MCP_SERVER_NAME, DEFAULT_MCP_SERVER_URL
from ..git import infer_repo_ref
from ..platforms import load_platforms
from ..ui import (
    PromptChrome,
    SelectOption,
    console,
    flow_chrome,
    prompt_confirm,
    prompt_select,
    with_spinner,
)


def parse_scopes(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    return [item.strip() for item in raw.replace(",", " ").split() if item.strip()]


def resolve_identity(context: dict[str, Any] | None, fallback: str | None = None) -> str | None:
    user = (context or {}).get("user") or {}
    return user.get("email") or user.get("displayName") or user.get("id") or fallback


def resolve_organization(context: dict[str, Any] | None) -> str | None:
    if not context:
        return None
    organization = context.get("activeOrganization") or ((context.get("organizations") or [None])[0])
    if not organization:
        return None
    org_name = str(organization.get("orgName", ""))
    org_id = str(organization.get("orgId", ""))
    return org_name if org_name == org_id else f"{org_name} ({org_id})"


def resolve_auth_user(context: dict[str, Any] | None) -> dict[str, str] | None:
    user = (context or {}).get("user") or {}
    auth_user = {}
    if user.get("id"):
        auth_user["id"] = str(user["id"]).strip()
    if user.get("email"):
        auth_user["email"] = str(user["email"]).strip()
    if user.get("displayName"):
        auth_user["name"] = str(user["displayName"]).strip()
    return auth_user or None


def persist_auth_user(auth: AuthState, context: dict[str, Any] | None) -> AuthState:
    user = resolve_auth_user(context)
    if not user or auth.user == user:
        return auth
    next_state = AuthState(
        apiBaseUrl=auth.apiBaseUrl,
        issuerUrl=auth.issuerUrl,
        clientId=auth.clientId,
        audience=auth.audience,
        scopes=auth.scopes,
        tokenType=auth.tokenType,
        accessToken=auth.accessToken,
        refreshToken=auth.refreshToken,
        expiresAt=auth.expiresAt,
        issuedAt=auth.issuedAt,
        method=auth.method,
        user=user,
    )
    write_auth_state(next_state)
    return next_state


def load_session_context(token: str, api_base_url: str | None = None) -> dict[str, Any] | None:
    try:
        return with_spinner("Loading DecisionOps workspace...", lambda: load_user_context(token=token, apiBaseUrl=api_base_url))
    except Exception:
        return None


def print_login_summary(lines: list[str]) -> None:
    console.print(Panel.fit("\n".join(lines), border_style="cyan"))


def normalize_repo_ref(value: str) -> str:
    normalized = value.strip().rstrip("/").removesuffix(".git")
    for prefix in ("git@github.com:", "https://github.com/", "http://github.com/", "ssh://git@github.com/"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]
            break
    return normalized


def detect_repo_ref(repo_path: str) -> str | None:
    try:
        return normalize_repo_ref(infer_repo_ref(repo_path))
    except Exception:
        return None


def is_interactive() -> bool:
    return bool(sys.stdin.isatty() and sys.stdout.isatty())


def choose_platforms(
    initial_ids: list[str] | None,
    platforms_dir: str,
    eyebrow: str,
    *,
    with_descriptions: bool = True,
) -> list[str]:
    if initial_ids:
        return initial_ids
    if not is_interactive():
        raise RuntimeError("No platform selected. Use --platform in non-interactive mode.")
    platforms = list(load_platforms(platforms_dir).values())
    chosen: set[str] = set()
    add_another = True
    while add_another:
        platform_id = prompt_select(
            f"Choose a platform to {'install' if eyebrow == 'Install' else 'clean up'}",
            [
                SelectOption(
                    label=platform.display_name,
                    value=platform.id,
                    description=(f"Target id: {platform.id}" if with_descriptions else None),
                )
                for platform in platforms
            ],
            flow_chrome(PromptChrome(eyebrow=eyebrow)),
        )
        chosen.add(platform_id)
        remaining = [platform for platform in platforms if platform.id not in chosen]
        if not remaining:
            break
        add_another = prompt_confirm("Add another platform?", False, flow_chrome(PromptChrome(eyebrow=eyebrow)))
    return list(chosen)


def auth_display(auth: AuthState) -> str:
    from ..auth import is_expired

    identity = (auth.user or {}).get("email") or (auth.user or {}).get("name") or (auth.user or {}).get("id") or "unknown"
    expiry = f"{auth.expiresAt}{' (expired)' if is_expired(auth) else ''}" if auth.expiresAt else "session"
    return f"{identity} via {auth.method} • {expiry}"


def decision_id(decision: dict[str, Any]) -> str:
    return str(decision.get("decisionId") or decision.get("id") or "")


def require_project_binding(client: DopsClient) -> tuple[str, str]:
    if not client.org_id or not client.project_id:
        raise RuntimeError("This command requires a bound repository. Run `dops init` first.")
    return client.org_id, client.project_id


def resolve_server_name(value: str | None) -> str:
    return value or DEFAULT_MCP_SERVER_NAME


def resolve_server_url(value: str | None) -> str:
    return value or DEFAULT_MCP_SERVER_URL
