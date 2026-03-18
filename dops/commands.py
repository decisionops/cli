from __future__ import annotations

import os
import platform
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

from rich.panel import Panel

from .api_client import DopsClient, load_user_context
from .auth import (
    AuthState,
    clear_auth_state,
    default_client_id,
    ensure_valid_auth_state,
    is_expired,
    login_with_pkce,
    read_auth_state,
    revoke_auth_state,
    save_token_auth_state,
    write_auth_state,
)
from .config import (
    DEFAULT_MCP_SERVER_NAME,
    DEFAULT_MCP_SERVER_URL,
    PLACEHOLDER_ORG_ID,
    PLACEHOLDER_PROJECT_ID,
    PLACEHOLDER_REPO_REF,
)
from .git import find_repo_root, git_changed_files, infer_default_branch, infer_repo_ref, resolve_repo_path
from .installer import build_platforms, cleanup_platforms, install_platforms
from .installers.templates import POWERSHELL_INSTALLER_URL, SHELL_INSTALLER_URL
from .manifest import read_manifest, write_manifest
from .platforms import load_platforms
from .resources import find_platforms_dir, find_skill_source_dir
from .ui import (
    PromptChrome,
    SelectOption,
    console,
    flow_chrome,
    prompt_confirm,
    prompt_select,
    prompt_text,
    render_auth_status,
    render_cleanup_summary,
    render_doctor_report,
    render_install_summary,
    reset_flow_state,
    run_login_flow,
    with_spinner,
)


def _parse_scopes(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    return [item.strip() for item in raw.replace(",", " ").split() if item.strip()]


def _resolve_identity(context: dict[str, Any] | None, fallback: str | None = None) -> str | None:
    user = (context or {}).get("user") or {}
    return user.get("email") or user.get("displayName") or user.get("id") or fallback


def _resolve_organization(context: dict[str, Any] | None) -> str | None:
    if not context:
        return None
    organization = context.get("activeOrganization") or ((context.get("organizations") or [None])[0])
    if not organization:
        return None
    org_name = str(organization.get("orgName", ""))
    org_id = str(organization.get("orgId", ""))
    return org_name if org_name == org_id else f"{org_name} ({org_id})"


def _resolve_auth_user(context: dict[str, Any] | None) -> dict[str, str] | None:
    user = (context or {}).get("user") or {}
    auth_user = {}
    if user.get("id"):
        auth_user["id"] = str(user["id"]).strip()
    if user.get("email"):
        auth_user["email"] = str(user["email"]).strip()
    if user.get("displayName"):
        auth_user["name"] = str(user["displayName"]).strip()
    return auth_user or None


def _persist_auth_user(auth: AuthState, context: dict[str, Any] | None) -> AuthState:
    user = _resolve_auth_user(context)
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


def _load_session_context(token: str, api_base_url: str | None = None) -> dict[str, Any] | None:
    try:
        return with_spinner("Loading DecisionOps workspace...", lambda: load_user_context(token=token, apiBaseUrl=api_base_url))
    except Exception:
        return None


def _print_login_summary(lines: list[str]) -> None:
    console.print(Panel.fit("\n".join(lines), border_style="cyan"))


def run_login(flags) -> None:
    reset_flow_state()
    scopes = _parse_scopes(flags.scopes)
    auth_options = {
        "apiBaseUrl": flags.api_base_url,
        "issuerUrl": flags.issuer_url,
        "clientId": flags.client_id,
        "audience": flags.audience,
        "scopes": scopes,
    }
    if flags.clear:
        current = read_auth_state()
        if current:
            with_spinner("Revoking session...", lambda: revoke_auth_state(current))
        clear_auth_state()
        console.print("Cleared saved auth state.")
        return
    if not flags.with_token and not flags.force:
        current = read_auth_state()
        if current:
            auth = with_spinner("Checking existing DecisionOps session...", lambda: ensure_valid_auth_state(current))
            context = _load_session_context(auth.accessToken, auth.apiBaseUrl)
            auth = _persist_auth_user(auth, context)
            if context:
                _print_login_summary(
                    [
                        "You are already logged into AI DecisionOps",
                        *([f"Logged into org: {_resolve_organization(context)}"] if _resolve_organization(context) else ["Saved session is ready to use"]),
                        *([f"Authenticated as: {_resolve_identity(context)}"] if _resolve_identity(context) else []),
                        "Run `dops logout` if you want to sign in again.",
                    ]
                )
                return
    if flags.with_token:
        token = (flags.token or "").strip()
        if not token:
            raise RuntimeError("Pass --token with an already-issued DecisionOps bearer access token. Raw org API keys are not accepted here.")
        state, storage_path = save_token_auth_state(token=token, **auth_options)
        context = _load_session_context(token, state.apiBaseUrl)
        _persist_auth_user(state, context)
        console.print(f"Saved auth token -> {storage_path}")
        _print_login_summary(
            [
                "Welcome to AI DecisionOps",
                *([f"Logged into org: {_resolve_organization(context)}"] if _resolve_organization(context) else ["Advanced token saved for dops CLI"]),
                *([f"Authenticated as: {_resolve_identity(context)}"] if _resolve_identity(context) else []),
            ]
        )
        return
    if sys.stdin.isatty() and sys.stdout.isatty():
        flow_result = run_login_flow(
            client_display=flags.client_id or default_client_id(),
            login_with_browser=lambda on_authorize_url: login_with_pkce(
                openBrowser=not flags.no_browser,
                onAuthorizeUrl=on_authorize_url,
                **auth_options,
            ),
        )
    else:
        printed = False

        def on_authorize_url(url: str) -> None:
            nonlocal printed
            if printed:
                return
            printed = True
            console.print("Open this URL in your browser to continue authentication:")
            console.print(url)

        flow_result = login_with_pkce(openBrowser=not flags.no_browser, onAuthorizeUrl=on_authorize_url, **auth_options)
    context = _load_session_context(flow_result.state.accessToken, flow_result.state.apiBaseUrl)
    saved_state = _persist_auth_user(flow_result.state, context)
    identity = (
        (saved_state.user or {}).get("email")
        or (saved_state.user or {}).get("name")
        or (saved_state.user or {}).get("id")
        or "unknown"
    )
    console.print(f"Saved -> {flow_result.storagePath}")
    _print_login_summary(
        [
            "Welcome to AI DecisionOps",
            *([f"Logged into org: {_resolve_organization(context)}"] if _resolve_organization(context) else ["Signed into dops CLI successfully"]),
            *([f"Authenticated as: {_resolve_identity(context, identity)}"] if _resolve_identity(context, identity) else []),
        ]
    )


def run_logout() -> None:
    current = read_auth_state()
    if not current:
        console.print("No DecisionOps session stored locally.")
        return
    with_spinner("Revoking session...", lambda: revoke_auth_state(current))
    clear_auth_state()
    console.print("Logged out and removed the local session.")


def run_auth_status() -> int:
    current = read_auth_state()
    if not current:
        console.print("Auth: missing")
        return 1
    auth = ensure_valid_auth_state(current)
    render_auth_status(auth)
    return 0


def _normalize_repo_ref(value: str) -> str:
    normalized = value.strip().rstrip("/").removesuffix(".git")
    for prefix in ("git@github.com:", "https://github.com/", "http://github.com/", "ssh://git@github.com/"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]
            break
    return normalized


def _detect_repo_ref(repo_path: str) -> str | None:
    try:
        return _normalize_repo_ref(infer_repo_ref(repo_path))
    except Exception:
        return None


def run_init(flags) -> None:
    reset_flow_state()
    repo_path = resolve_repo_path(flags.repo_path)
    if not repo_path:
        raise RuntimeError("Could not determine repository path. Use --repo-path.")
    allow_placeholders = bool(flags.allow_placeholders)
    detected_repo_ref = _normalize_repo_ref(flags.repo_ref) if flags.repo_ref else _detect_repo_ref(repo_path)
    default_branch = flags.default_branch or infer_default_branch(repo_path)
    org_id = flags.org_id
    project_id = flags.project_id
    repo_ref = detected_repo_ref
    if not org_id and not project_id and allow_placeholders:
        org_id = PLACEHOLDER_ORG_ID
        project_id = PLACEHOLDER_PROJECT_ID
        repo_ref = repo_ref or PLACEHOLDER_REPO_REF
    elif not org_id or not project_id:
        if not (sys.stdin.isatty() and sys.stdout.isatty()):
            raise RuntimeError("--org-id and --project-id are required. Use --allow-placeholders for local prototyping.")
        if not org_id:
            org_id = prompt_text(
                title="DecisionOps org_id",
                placeholder=PLACEHOLDER_ORG_ID if allow_placeholders else "org_...",
                validate=lambda value: None if value else "org_id is required.",
            )
        if not project_id:
            project_id = prompt_text(
                title="DecisionOps project_id",
                placeholder=PLACEHOLDER_PROJECT_ID if allow_placeholders else "proj_...",
                validate=lambda value: None if value else "project_id is required.",
            )
    if not repo_ref:
        if allow_placeholders:
            repo_ref = PLACEHOLDER_REPO_REF
        elif sys.stdin.isatty() and sys.stdout.isatty():
            repo_ref = _normalize_repo_ref(
                prompt_text(
                    title="Repository reference (owner/repo)",
                    placeholder="owner/repo",
                    validate=lambda value: None if value else "repo_ref is required.",
                )
            )
        else:
            raise RuntimeError("Could not infer repo_ref. Pass --repo-ref or use --allow-placeholders.")
    manifest_path = write_manifest(
        repo_path,
        {
            "org_id": str(org_id),
            "project_id": str(project_id),
            "repo_ref": str(repo_ref),
            "default_branch": default_branch,
            "mcp_server_name": flags.server_name or DEFAULT_MCP_SERVER_NAME,
            "mcp_server_url": flags.server_url or DEFAULT_MCP_SERVER_URL,
            "repo_id": flags.repo_id,
        },
    )
    console.print(f"Wrote manifest: {manifest_path}")


def _is_interactive() -> bool:
    return bool(sys.stdin.isatty() and sys.stdout.isatty())


def _choose_platforms(initial_ids: list[str] | None, platforms_dir: str, eyebrow: str, with_descriptions: bool = True) -> list[str]:
    if initial_ids:
        return initial_ids
    if not _is_interactive():
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


def run_install(flags) -> None:
    reset_flow_state()
    platforms_dir = find_platforms_dir()
    selected_platforms = _choose_platforms(flags.platform, platforms_dir, "Install")
    repo_path = resolve_repo_path(flags.repo_path)
    source_dir = flags.source_dir if flags.source_dir or flags.skip_skill else find_skill_source_dir()
    result = install_platforms(
        {
            "platforms_dir": platforms_dir,
            "selected_platforms": selected_platforms,
            "repo_path": repo_path,
            "org_id": flags.org_id,
            "project_id": flags.project_id,
            "repo_ref": flags.repo_ref,
            "repo_id": flags.repo_id,
            "default_branch": flags.default_branch,
            "install_skill": not flags.skip_skill,
            "install_mcp": not flags.skip_mcp,
            "write_manifest": not flags.skip_manifest,
            "allow_placeholders": flags.allow_placeholders,
            "output_dir": flags.output_dir,
            "source_dir": source_dir,
            "skill_name": flags.skill_name,
            "server_name": flags.server_name,
            "server_url": flags.server_url,
        }
    )
    render_install_summary(result)


def run_uninstall(flags) -> None:
    reset_flow_state()
    platforms_dir = find_platforms_dir()
    selected_platforms = _choose_platforms(flags.platform, platforms_dir, "Uninstall", with_descriptions=False)
    repo_path = resolve_repo_path(flags.repo_path)
    result = cleanup_platforms(
        {
            "platforms_dir": platforms_dir,
            "selected_platforms": selected_platforms,
            "repo_path": repo_path,
            "skill_name": flags.skill_name,
            "server_name": flags.server_name,
            "remove_skill": not flags.skip_skill,
            "remove_mcp": not flags.skip_mcp,
            "remove_manifest": flags.remove_manifest,
            "remove_auth_handoff": flags.remove_auth_handoff,
        }
    )
    render_cleanup_summary(result)
    if not flags.skip_auth:
        current = read_auth_state()
        if current:
            with_spinner("Revoking session...", lambda: revoke_auth_state(current))
            clear_auth_state()
            console.print("Removed local auth state.")


def _auth_display(auth: AuthState) -> str:
    identity = (auth.user or {}).get("email") or (auth.user or {}).get("name") or (auth.user or {}).get("id") or "unknown"
    expiry = f"{auth.expiresAt}{' (expired)' if is_expired(auth) else ''}" if auth.expiresAt else "session"
    return f"{identity} via {auth.method} • {expiry}"


def run_doctor(flags) -> None:
    repo_path = resolve_repo_path(flags.repo_path)
    current_auth = read_auth_state()
    auth = ensure_valid_auth_state(current_auth) if current_auth else None
    issues: list[str] = []
    if not auth:
        issues.append("CLI auth not configured")
    manifest = read_manifest(repo_path) if repo_path else None
    if not repo_path:
        issues.append("Not inside a git repository")
    elif not manifest:
        issues.append("No .decisionops/manifest.toml found")
    elif not manifest.get("org_id") or not manifest.get("project_id") or not manifest.get("repo_ref"):
        issues.append("Manifest is missing required fields (org_id, project_id, or repo_ref)")
    platform_statuses: list[dict[str, str]] = []
    try:
        platforms = load_platforms(find_platforms_dir())
        context = {"skill_name": "decision-ops", "repo_path": repo_path or ""}
        from .platforms import resolve_install_path

        for platform_def in platforms.values():
            skill_path = resolve_install_path(platform_def.skill, context) if platform_def.skill and platform_def.skill.supported else None
            mcp_path = resolve_install_path(platform_def.mcp, context) if platform_def.mcp and platform_def.mcp.supported else None
            platform_statuses.append(
                {
                    "displayName": platform_def.display_name,
                    "skillStatus": "n/a"
                    if not (platform_def.skill and platform_def.skill.supported)
                    else f"installed ({skill_path})"
                    if skill_path and Path(skill_path).exists()
                    else "not installed",
                    "mcpStatus": "n/a"
                    if not (platform_def.mcp and platform_def.mcp.supported)
                    else f"configured ({mcp_path})"
                    if mcp_path and Path(mcp_path).exists()
                    else "not configured",
                }
            )
    except Exception:
        platform_statuses = []
    render_doctor_report(
        auth=auth,
        auth_display=_auth_display(auth) if auth else "",
        repo_path=repo_path,
        manifest=manifest,
        platforms=platform_statuses,
        issues=issues,
    )


def _decision_id(decision: dict[str, Any]) -> str:
    return str(decision.get("decisionId") or decision.get("id") or "")


def run_decisions_list(flags) -> None:
    client = DopsClient.from_auth(resolve_repo_path(flags.repo_path) or None)
    decisions = client.list_decisions({"status": flags.status, "type": flags.type, "limit": int(flags.limit or 20)})
    if not decisions:
        console.print("No decisions found.")
        return
    for decision in decisions:
        status = str(decision.get("status") or "–").ljust(12)
        decision_type = str(decision.get("type") or "–").ljust(12)
        title = str(decision.get("title") or "–")
        console.print(f"{_decision_id(decision)}  {status}  {decision_type}  {title}")


def run_decisions_get(decision_id: str, flags) -> None:
    client = DopsClient.from_auth(resolve_repo_path(flags.repo_path) or None)
    decision = client.get_decision(decision_id)
    console.print(f"ID:       {_decision_id(decision)}")
    console.print(f"Title:    {decision.get('title')}")
    console.print(f"Status:   {decision.get('status')}")
    console.print(f"Type:     {decision.get('type')}")
    console.print(f"Version:  {decision.get('version')}")
    if decision.get("context"):
        console.print(f"Context:  {decision.get('context')}")
    if decision.get("outcome"):
        console.print(f"Outcome:  {decision.get('outcome')}")
    if decision.get("options"):
        console.print("Options:")
        for option in decision["options"]:
            console.print(f"  - {option.get('name')}{': ' + option.get('description') if option.get('description') else ''}")
            if option.get("pros"):
                console.print(f"    Pros: {', '.join(option['pros'])}")
            if option.get("cons"):
                console.print(f"    Cons: {', '.join(option['cons'])}")
    if decision.get("consequences"):
        console.print("Consequences:")
        for consequence in decision["consequences"]:
            console.print(f"  - {consequence}")
    if decision.get("createdAt"):
        console.print(f"Created:  {decision.get('createdAt')}")
    if decision.get("updatedAt"):
        console.print(f"Updated:  {decision.get('updatedAt')}")


def run_decisions_search(terms: str, flags) -> None:
    client = DopsClient.from_auth(resolve_repo_path(flags.repo_path) or None)
    result = client.search_decisions(terms, {"mode": flags.mode} if flags.mode else None)
    decisions = result.get("decisions", []) if isinstance(result, dict) else []
    total = int(result.get("total", len(decisions))) if isinstance(result, dict) else len(decisions)
    if not decisions:
        console.print("No matching decisions found.")
        return
    console.print(f"Found {total} result{'s' if total != 1 else ''}:")
    for decision in decisions:
        console.print(f"  {_decision_id(decision)}  {str(decision.get('status', '')).ljust(12)}  {decision.get('title')}")


def run_decisions_create(flags) -> None:
    reset_flow_state()
    client = DopsClient.from_auth(resolve_repo_path(flags.repo_path) or None)
    title = prompt_text(title="Decision title", placeholder="What decision are you recording?", validate=lambda value: None if value else "Title is required.")
    decision_type = prompt_select(
        "Decision type",
        [
            SelectOption("Technical", "technical", "Architecture, tooling, infrastructure"),
            SelectOption("Product", "product", "Features, UX, roadmap"),
            SelectOption("Business", "business", "Strategy, process, organization"),
            SelectOption("Governance", "governance", "Policies, standards, compliance"),
        ],
    )
    context = prompt_text(title="Context (what prompted this decision?)", placeholder="Describe the situation...")
    result = client.create_decision({"title": title, "type": decision_type, "context": context or None})
    decision = result.get("decision", result) if isinstance(result, dict) else {}
    console.print(f"Created decision: {_decision_id(decision)} (v{decision.get('version', '?')})")


def run_gate(flags) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    task_summary = flags.task
    if not task_summary:
        if not sys.stdin.isatty():
            raise RuntimeError("--task is required in non-interactive mode.")
        task_summary = prompt_text(
            title="What task are you working on?",
            placeholder="Describe the task or change...",
            validate=lambda value: None if value else "Task summary is required.",
        )
    repo_ref = client.repo_ref
    if not repo_ref and repo_path:
        try:
            repo_ref = infer_repo_ref(repo_path)
        except Exception:
            repo_ref = None
    if not repo_ref:
        raise RuntimeError("Could not determine repo_ref. Run `dops init` or pass --repo-path inside a configured repo.")
    root = repo_path or find_repo_root() or None
    changed_paths = git_changed_files(root) if root else []
    result = with_spinner("Running decision gate...", lambda: client.prepare_gate(repo_ref, task_summary, changed_paths or None))
    console.print(f"Recordable:  {'yes' if result.get('recordable') else 'no'}")
    confidence = result.get("confidence")
    if confidence is not None:
        console.print(f"Confidence:  {round(float(confidence) * 100):.0f}%")
    if result.get("classification_reason"):
        console.print(f"Reasoning:   {result['classification_reason']}")
    elif result.get("reasoning"):
        console.print(f"Reasoning:   {result['reasoning']}")
    if result.get("suggested_mode"):
        console.print(f"Mode:        {result['suggested_mode']}")


def _require_project_binding(client: DopsClient) -> tuple[str, str]:
    if not client.org_id or not client.project_id:
        raise RuntimeError("This command requires a bound repository. Run `dops init` first.")
    return client.org_id, client.project_id


def run_validate(decision_id: str | None, flags) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    org_id, project_id = _require_project_binding(client)
    payload: dict[str, Any] = {"org_id": org_id, "project_id": project_id}
    if decision_id:
        payload["decision_id"] = decision_id
    result = with_spinner("Validating decision...", lambda: client.validate_decision(payload))
    console.print(f"Valid: {'yes' if result.get('valid') else 'no'}")
    errors = result.get("errors") or []
    warnings = result.get("warnings") or []
    if errors:
        console.print("Errors:")
        for error in errors:
            console.print(f"  - {error.get('message') if isinstance(error, dict) else error}")
    if warnings:
        console.print("Warnings:")
        for warning in warnings:
            console.print(f"  - {warning.get('message') if isinstance(warning, dict) else warning}")


def run_publish(decision_id: str, flags) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    org_id, project_id = _require_project_binding(client)
    expected_version = int(flags.version) if flags.version else None
    if expected_version is None:
        decision = client.get_decision(decision_id)
        if decision.get("version") is None:
            raise RuntimeError("Could not determine current decision version. Pass --version.")
        expected_version = int(decision["version"])
    result = with_spinner(
        "Publishing decision...",
        lambda: client.publish_decision(
            {"org_id": org_id, "project_id": project_id, "decision_id": decision_id, "expected_version": expected_version}
        ),
    )
    console.print(f"Published: {result.get('decision_id', decision_id)} (v{result.get('version', expected_version)})")


def run_status(flags) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    snapshot, alerts = with_spinner("Loading governance data...", lambda: (client.get_monitoring_snapshot(), client.get_alerts()))
    console.print("Governance Snapshot")
    console.print(f"  Total decisions: {snapshot.get('totalDecisions', snapshot.get('total_decisions', 'n/a'))}")
    console.print(f"  Coverage:        {snapshot.get('coveragePercent', snapshot.get('coverage_percent', 'n/a'))}%")
    console.print(f"  Health:          {snapshot.get('healthPercent', snapshot.get('health_percent', 'n/a'))}%")
    console.print(f"  Drift rate:      {snapshot.get('driftRate', snapshot.get('drift_rate', 'n/a'))}")
    by_status = snapshot.get("byStatus") or snapshot.get("by_status") or {}
    if isinstance(by_status, dict) and by_status:
        console.print("  By status:")
        for status, count in by_status.items():
            console.print(f"    {status}: {count}")
    if alerts:
        console.print(f"\nAlerts ({len(alerts)}):")
        for alert in alerts:
            console.print(f"  [{alert.get('severity', 'info')}] {alert.get('message', '')}")


def run_platform_list() -> None:
    platforms = load_platforms(find_platforms_dir())
    for platform_def in platforms.values():
        caps = ", ".join(
            capability
            for capability, supported in (
                ("skill", bool(platform_def.skill and platform_def.skill.supported)),
                ("mcp", bool(platform_def.mcp and platform_def.mcp.supported)),
            )
            if supported
        )
        console.print(f"{platform_def.id.ljust(16)} {platform_def.display_name.ljust(16)} [{caps}]", markup=False)


def run_platform_build(flags) -> None:
    results = build_platforms(
        {
            "platforms_dir": find_platforms_dir(),
            "selected_platforms": flags.platform,
            "output_dir": flags.output_dir or "build",
            "source_dir": flags.source_dir or find_skill_source_dir(),
            "skill_name": flags.skill_name,
            "server_name": flags.server_name,
            "server_url": flags.server_url,
        }
    )
    for result in results:
        console.print(f"Built {result['platform_id']} -> {result['output_path']}")


def run_update(flags) -> None:
    target_version = flags.version or "latest"
    console.print(f"Updating dops to {target_version}...")
    env = os.environ.copy()
    if flags.version:
        env["DOPS_VERSION"] = flags.version
    if flags.install_dir:
        env["DOPS_INSTALL_DIR"] = flags.install_dir
    if platform.system().lower().startswith("win"):
        command = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", f"irm {POWERSHELL_INSTALLER_URL} | iex"]
    else:
        command = ["sh", "-c", f"curl -fsSL {shlex.quote(SHELL_INSTALLER_URL)} | sh"]
    completed = subprocess.run(command, env=env, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"Update failed with exit code {completed.returncode}.")
