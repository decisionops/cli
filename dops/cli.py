from __future__ import annotations

import argparse
import sys

from . import __version__
from .commands import (
    run_auth_status,
    run_decisions_create,
    run_decisions_get,
    run_decisions_list,
    run_decisions_search,
    run_doctor,
    run_gate,
    run_init,
    run_install,
    run_login,
    run_logout,
    run_platform_build,
    run_platform_list,
    run_publish,
    run_status,
    run_uninstall,
    run_update,
    run_validate,
)
from .ui import CancelledError, error_console

SUPPORTED_PLATFORM_IDS = ["codex", "claude-code", "cursor", "vscode", "antigravity"]


class DopsHelpFormatter(argparse.RawDescriptionHelpFormatter):
    pass


def _add_examples(parser: argparse.ArgumentParser, examples: list[str]) -> None:
    section = "Examples:\n" + "\n".join(f"  {example}" for example in examples)
    parser.epilog = f"{parser.epilog}\n\n{section}" if parser.epilog else section


def _add_notes(parser: argparse.ArgumentParser, notes: list[str]) -> None:
    section = "Notes:\n" + "\n".join(f"  {note}" for note in notes)
    parser.epilog = f"{parser.epilog}\n\n{section}" if parser.epilog else section


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dops",
        formatter_class=DopsHelpFormatter,
        description="dops — repo-anchored CLI for working with decisions\n\nRespects NO_COLOR and FORCE_COLOR environment variables.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command")
    _add_examples(
        parser,
        [
            "dops login",
            "dops init --org-id acme --project-id backend --repo-ref acme/backend",
            "dops install --platform codex",
            "dops update",
            "dops doctor",
        ],
    )

    login = subparsers.add_parser("login", formatter_class=DopsHelpFormatter, help="Authenticate this machine with DecisionOps", description="Authenticate this machine with DecisionOps")
    login.add_argument("--api-base-url")
    login.add_argument("--issuer-url")
    login.add_argument("--client-id")
    login.add_argument("--audience")
    login.add_argument("--scopes")
    login.add_argument("--web", action="store_true", help="Use browser-based PKCE login (default)")
    login.add_argument("--with-token", action="store_true", help=argparse.SUPPRESS)
    login.add_argument("--token", help=argparse.SUPPRESS)
    login.add_argument("--no-browser", action="store_true", help="Do not attempt to launch a browser automatically")
    login.add_argument("--force", action="store_true", help="Start a new browser login even if a saved session already exists")
    login.add_argument("--clear", action="store_true", help="Remove saved login state")
    login.set_defaults(func=run_login)
    _add_examples(login, ["dops login", "dops login --web"])

    logout = subparsers.add_parser("logout", formatter_class=DopsHelpFormatter, help="Revoke and remove the local DecisionOps session", description="Revoke and remove the local DecisionOps session")
    logout.set_defaults(func=lambda args: run_logout())

    auth = subparsers.add_parser("auth", formatter_class=DopsHelpFormatter, help="Inspect or manage the current DecisionOps auth session", description="Inspect or manage the current DecisionOps auth session")
    auth_subparsers = auth.add_subparsers(dest="auth_command")
    _add_examples(auth, ["dops auth status"])
    auth_status = auth_subparsers.add_parser("status", formatter_class=DopsHelpFormatter, help="Show the current auth session", description="Show the current auth session")
    auth_status.set_defaults(func=lambda args: run_auth_status())

    init = subparsers.add_parser("init", formatter_class=DopsHelpFormatter, help="Bind the current repository to a DecisionOps project", description="Bind the current repository to a DecisionOps project")
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
    _add_examples(init, ["dops init --org-id acme --project-id backend --repo-ref acme/backend", "dops init --allow-placeholders"])

    install = subparsers.add_parser("install", formatter_class=DopsHelpFormatter, help="Install DecisionOps skill + MCP config for chosen platforms", description="Install DecisionOps skill + MCP config for chosen platforms")
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
    _add_examples(
        install,
        [
            "dops install --platform codex",
            "dops install --platform claude-code",
            "dops install --platform codex --platform cursor",
            "dops install --platform codex --skip-mcp",
        ],
    )
    _add_notes(install, [f"Supported platform ids: {', '.join(SUPPORTED_PLATFORM_IDS)}"])

    uninstall = subparsers.add_parser("uninstall", formatter_class=DopsHelpFormatter, help="Remove installed DecisionOps skills, MCP entries, and local auth state", description="Remove installed DecisionOps skills, MCP entries, and local auth state", aliases=["cleanup"])
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
    _add_examples(
        uninstall,
        [
            "dops uninstall --platform codex",
            "dops uninstall --platform claude-code --remove-manifest --skip-auth",
        ],
    )
    _add_notes(uninstall, [f"Supported platform ids: {', '.join(SUPPORTED_PLATFORM_IDS)}"])

    update = subparsers.add_parser("update", formatter_class=DopsHelpFormatter, help="Update the dops CLI to the latest released binary", description="Update the dops CLI to the latest released binary", aliases=["self-update"])
    update.add_argument("--version")
    update.add_argument("--install-dir")
    update.set_defaults(func=run_update)
    _add_examples(update, ["dops update", "dops update --version v0.1.0"])

    doctor = subparsers.add_parser("doctor", formatter_class=DopsHelpFormatter, help="Diagnose local DecisionOps setup and suggest fixes", description="Diagnose local DecisionOps setup and suggest fixes")
    doctor.add_argument("--repo-path")
    doctor.set_defaults(func=run_doctor)
    _add_examples(doctor, ["dops doctor", "dops doctor --repo-path ~/projects/my-repo"])

    decisions = subparsers.add_parser("decisions", formatter_class=DopsHelpFormatter, help="Work with decisions", description="Work with decisions")
    decisions_subparsers = decisions.add_subparsers(dest="decisions_command")
    _add_examples(decisions, ["dops decisions list", "dops decisions get dec_123", "dops decisions search auth onboarding", "dops decisions create"])

    decisions_list = decisions_subparsers.add_parser("list", formatter_class=DopsHelpFormatter, help="List decisions", description="List decisions")
    decisions_list.add_argument("--status")
    decisions_list.add_argument("--type")
    decisions_list.add_argument("--limit", default="20")
    decisions_list.add_argument("--repo-path")
    decisions_list.set_defaults(func=run_decisions_list)

    decisions_get = decisions_subparsers.add_parser("get", formatter_class=DopsHelpFormatter, help="Get a decision by ID", description="Get a decision by ID")
    decisions_get.add_argument("id")
    decisions_get.add_argument("--repo-path")
    decisions_get.set_defaults(func=lambda args: run_decisions_get(args.id, args))

    decisions_search = decisions_subparsers.add_parser("search", formatter_class=DopsHelpFormatter, help="Search decisions by keywords", description="Search decisions by keywords")
    decisions_search.add_argument("terms", nargs="+")
    decisions_search.add_argument("--mode")
    decisions_search.add_argument("--repo-path")
    decisions_search.set_defaults(func=lambda args: run_decisions_search(" ".join(args.terms), args))

    decisions_create = decisions_subparsers.add_parser("create", formatter_class=DopsHelpFormatter, help="Create a new decision (interactive)", description="Create a new decision (interactive)")
    decisions_create.add_argument("--repo-path")
    decisions_create.set_defaults(func=run_decisions_create)

    gate = subparsers.add_parser("gate", formatter_class=DopsHelpFormatter, help="Run decision gate on current task", description="Run decision gate on current task")
    gate.add_argument("--task")
    gate.add_argument("--repo-path")
    gate.set_defaults(func=run_gate)
    _add_examples(gate, ['dops gate --task "add oauth callback validation"'])

    validate = subparsers.add_parser("validate", formatter_class=DopsHelpFormatter, help="Validate a decision against org constraints", description="Validate a decision against org constraints")
    validate.add_argument("id", nargs="?")
    validate.add_argument("--repo-path")
    validate.set_defaults(func=lambda args: run_validate(args.id, args))
    _add_examples(validate, ["dops validate", "dops validate dec_123"])

    publish = subparsers.add_parser("publish", formatter_class=DopsHelpFormatter, help="Publish a proposed decision (transition to accepted)", description="Publish a proposed decision (transition to accepted)")
    publish.add_argument("id")
    publish.add_argument("--version")
    publish.add_argument("--repo-path")
    publish.set_defaults(func=lambda args: run_publish(args.id, args))
    _add_examples(publish, ["dops publish dec_123", "dops publish dec_123 --version 7"])

    status = subparsers.add_parser("status", formatter_class=DopsHelpFormatter, help="Governance snapshot: coverage, health, drift, alerts", description="Governance snapshot: coverage, health, drift, alerts")
    status.add_argument("--repo-path")
    status.set_defaults(func=run_status)
    _add_examples(status, ["dops status"])

    platform_parser = subparsers.add_parser("platform", formatter_class=DopsHelpFormatter, help="Platform registry operations", description="Platform registry operations")
    platform_subparsers = platform_parser.add_subparsers(dest="platform_command")
    _add_examples(platform_parser, ["dops platform list", "dops platform build --platform codex --output-dir build"])

    platform_list = platform_subparsers.add_parser("list", formatter_class=DopsHelpFormatter, help="List supported platforms", description="List supported platforms")
    platform_list.set_defaults(func=lambda args: run_platform_list())

    platform_build = platform_subparsers.add_parser("build", formatter_class=DopsHelpFormatter, help="Build platform bundles", description="Build platform bundles")
    platform_build.add_argument("-p", "--platform", action="append")
    platform_build.add_argument("--output-dir")
    platform_build.add_argument("--source-dir")
    platform_build.add_argument("--skill-name")
    platform_build.add_argument("--server-name")
    platform_build.add_argument("--server-url")
    platform_build.set_defaults(func=run_platform_build)
    _add_examples(platform_build, ["dops platform build --platform codex --output-dir build", "dops platform build --platform claude-code --source-dir ./skill/decision-ops"])

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    try:
        result = args.func(args)
        return int(result) if isinstance(result, int) else 0
    except CancelledError:
        print("\nCancelled.")
        return 0
    except Exception as error:
        error_console.print(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
