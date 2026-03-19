from __future__ import annotations

import argparse

from .auth import register_auth_commands
from .config_command import register_config_commands
from .decisions import register_decision_commands
from .operations import register_operation_commands
from .platforms import register_platform_commands
from .repo import register_repo_commands
from .update import register_update_command

SUPPORTED_PLATFORM_IDS = ["codex", "claude-code", "cursor", "vscode", "antigravity"]


def register_all_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    register_auth_commands(subparsers)
    register_config_commands(subparsers)
    register_repo_commands(subparsers, SUPPORTED_PLATFORM_IDS)
    register_decision_commands(subparsers)
    register_operation_commands(subparsers)
    register_platform_commands(subparsers, SUPPORTED_PLATFORM_IDS)
    register_update_command(subparsers)
