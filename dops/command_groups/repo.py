from __future__ import annotations

import argparse
import platform
import shutil
import sys
from pathlib import Path

from .. import __version__
from ..argparse_utils import DopsHelpFormatter, add_examples, add_notes
from ..auth import clear_auth_state, ensure_valid_auth_state, read_auth_state, revoke_auth_state
from ..config import PLACEHOLDER_ORG_ID, PLACEHOLDER_PROJECT_ID, PLACEHOLDER_REPO_REF, config_error, config_path
from ..git import infer_default_branch, resolve_repo_path
from ..installer import cleanup_platforms, install_platforms
from ..manifest import read_manifest, write_manifest
from ..platforms import load_platforms, resolve_install_path
from ..resources import find_platforms_dir, find_skill_source_dir
from ..tls import describe_tls_setup
from ..ui import console, prompt_text, render_cleanup_summary, render_doctor_report, render_install_summary, reset_flow_state, with_spinner
from .shared import auth_display, choose_platforms, detect_repo_ref, normalize_repo_ref, resolve_server_name, resolve_server_url


def run_init(flags: argparse.Namespace) -> None:
    reset_flow_state()
    repo_path = resolve_repo_path(flags.repo_path)
    if not repo_path:
        raise RuntimeError("Could not determine repository path. Use --repo-path.")
    allow_placeholders = bool(flags.allow_placeholders)
    detected_repo_ref = normalize_repo_ref(flags.repo_ref) if flags.repo_ref else detect_repo_ref(repo_path)
    default_branch = flags.default_branch or infer_default_branch(repo_path)
    org_id = flags.org_id
    project_id = flags.project_id
    repo_ref = detected_repo_ref
    from .shared import is_interactive

    if not org_id and not project_id and allow_placeholders:
        org_id = PLACEHOLDER_ORG_ID
        project_id = PLACEHOLDER_PROJECT_ID
        repo_ref = repo_ref or PLACEHOLDER_REPO_REF
    elif not org_id or not project_id:
        if not is_interactive():
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
        elif is_interactive():
            repo_ref = normalize_repo_ref(
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
            "mcp_server_name": resolve_server_name(flags.server_name),
            "mcp_server_url": resolve_server_url(flags.server_url),
            "repo_id": flags.repo_id,
        },
    )
    console.print(f"Wrote manifest: {manifest_path}")


def run_install(flags: argparse.Namespace) -> None:
    reset_flow_state()
    platforms_dir = find_platforms_dir()
    selected_platforms = choose_platforms(flags.platform, platforms_dir, "Install")
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


def run_uninstall(flags: argparse.Namespace) -> None:
    reset_flow_state()
    platforms_dir = find_platforms_dir()
    selected_platforms = choose_platforms(flags.platform, platforms_dir, "Uninstall", with_descriptions=False)
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
        try:
            current = read_auth_state()
        except RuntimeError as error:
            console.print(f"[yellow]{error}[/yellow]")
            clear_auth_state()
            console.print("Removed the corrupt local auth state.")
            current = None
        if current:
            with_spinner("Revoking session...", lambda: revoke_auth_state(current))
            clear_auth_state()
            console.print("Removed local auth state.")


def run_doctor(flags: argparse.Namespace) -> None:
    repo_path = resolve_repo_path(flags.repo_path)
    issues: list[str] = []
    tls_info = describe_tls_setup()
    system_info = {
        "CLI version": __version__,
        "Python": platform.python_version(),
        "OS": f"{platform.system()} {platform.release()}",
        "Invocation path": str(Path(sys.argv[0]).resolve()),
        "Shell `dops` path": shutil.which("dops") or "(not on PATH)",
        "SSL backend": tls_info["ssl_backend"],
        "CA source": tls_info["ca_source"],
    }
    if config_error():
        issues.append(config_error() or "")
    try:
        current_auth = read_auth_state()
    except RuntimeError as error:
        current_auth = None
        issues.append(str(error))
    auth = None
    if current_auth:
        try:
            auth = ensure_valid_auth_state(current_auth)
        except RuntimeError as error:
            issues.append(str(error))
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
    except (RuntimeError, OSError, ValueError) as error:
        issues.append(f"Could not load platform definitions: {error}")
        platform_statuses = []
    render_doctor_report(
        auth=auth,
        auth_display=auth_display(auth) if auth else "",
        repo_path=repo_path,
        manifest=manifest,
        platforms=platform_statuses,
        issues=issues,
        system_info=system_info,
        cli_config_path=str(config_path()),
        cli_config_error=config_error(),
    )


def register_repo_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser], supported_platform_ids: list[str]) -> None:
    init = subparsers.add_parser(
        "init",
        formatter_class=DopsHelpFormatter,
        help="Bind the current repository to a DecisionOps project",
        description="Bind the current repository to a DecisionOps project",
    )
    init.add_argument("--repo-path")
    init.add_argument("--api-base-url")
    init.add_argument("--org-id")
    init.add_argument("--project-id")
    init.add_argument("--repo-ref")
    init.add_argument("--repo-id")
    init.add_argument("--default-branch")
    init.add_argument("--user-session-token")
    init.add_argument("--allow-placeholders", action="store_true")
    init.add_argument("--server-name")
    init.add_argument("--server-url")
    init.set_defaults(func=run_init)
    add_examples(init, ["dops init --org-id acme --project-id backend --repo-ref acme/backend", "dops init --allow-placeholders"])

    install = subparsers.add_parser(
        "install",
        formatter_class=DopsHelpFormatter,
        help="Install DecisionOps skill + MCP config for chosen platforms",
        description="Install DecisionOps skill + MCP config for chosen platforms",
    )
    install.add_argument("-p", "--platform", action="append")
    install.add_argument("--repo-path")
    install.add_argument("--api-base-url")
    install.add_argument("--org-id")
    install.add_argument("--project-id")
    install.add_argument("--repo-ref")
    install.add_argument("--repo-id")
    install.add_argument("--default-branch")
    install.add_argument("--user-session-token")
    install.add_argument("--allow-placeholders", action="store_true")
    install.add_argument("--skip-manifest", action="store_true")
    install.add_argument("--skip-skill", action="store_true")
    install.add_argument("--skip-mcp", action="store_true")
    install.add_argument("--output-dir")
    install.add_argument("--source-dir")
    install.add_argument("--skill-name")
    install.add_argument("--server-name")
    install.add_argument("--server-url")
    install.add_argument("-y", "--yes", action="store_true")
    install.set_defaults(func=run_install)
    add_examples(
        install,
        [
            "dops install --platform codex",
            "dops install --platform claude-code",
            "dops install --platform codex --platform cursor",
            "dops install --platform codex --skip-mcp",
        ],
    )
    add_notes(install, [f"Supported platform ids: {', '.join(supported_platform_ids)}"])

    uninstall = subparsers.add_parser(
        "uninstall",
        formatter_class=DopsHelpFormatter,
        help="Remove installed DecisionOps skills, MCP entries, and local auth state",
        description="Remove installed DecisionOps skills, MCP entries, and local auth state",
        aliases=["cleanup"],
    )
    uninstall.add_argument("-p", "--platform", action="append")
    uninstall.add_argument("--repo-path")
    uninstall.add_argument("--skill-name")
    uninstall.add_argument("--server-name")
    uninstall.add_argument("--skip-skill", action="store_true")
    uninstall.add_argument("--skip-mcp", action="store_true")
    uninstall.add_argument("--skip-auth", action="store_true")
    uninstall.add_argument("--remove-manifest", action="store_true")
    uninstall.add_argument("--remove-auth-handoff", action="store_true")
    uninstall.set_defaults(func=run_uninstall)
    add_examples(
        uninstall,
        [
            "dops uninstall --platform codex",
            "dops uninstall --platform claude-code --remove-manifest --skip-auth",
        ],
    )
    add_notes(uninstall, [f"Supported platform ids: {', '.join(supported_platform_ids)}"])

    doctor = subparsers.add_parser(
        "doctor",
        formatter_class=DopsHelpFormatter,
        help="Diagnose local DecisionOps setup and suggest fixes",
        description="Diagnose local DecisionOps setup and suggest fixes",
    )
    doctor.add_argument("--repo-path")
    doctor.set_defaults(func=run_doctor)
    add_examples(doctor, ["dops doctor", "dops doctor --repo-path ~/projects/my-repo"])
