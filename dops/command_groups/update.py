from __future__ import annotations

import argparse
import os
import platform
import shlex
import subprocess

from ..argparse_utils import DopsHelpFormatter, add_examples
from ..installers.templates import POWERSHELL_INSTALLER_URL, SHELL_INSTALLER_URL


def run_update(flags: argparse.Namespace) -> None:
    from ..ui import console

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


def register_update_command(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    update = subparsers.add_parser(
        "update",
        formatter_class=DopsHelpFormatter,
        help="Update the dops CLI to the latest released binary",
        description="Update the dops CLI to the latest released binary",
        aliases=["self-update"],
    )
    update.add_argument("--version")
    update.add_argument("--install-dir")
    update.set_defaults(func=run_update)
    add_examples(update, ["dops update", "dops update --version v0.1.0"])
