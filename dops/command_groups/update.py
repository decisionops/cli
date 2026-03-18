from __future__ import annotations

import argparse
import os
import platform
import shlex
import shutil
import subprocess
from pathlib import Path

from ..argparse_utils import DopsHelpFormatter, add_examples
from ..installers.templates import POWERSHELL_INSTALLER_URL, SHELL_INSTALLER_URL


def _installed_binary_path(install_dir: str | None) -> Path:
    target_dir = Path(install_dir).expanduser() if install_dir else Path.home() / ".dops" / "bin"
    binary_name = "dops.exe" if platform.system().lower().startswith("win") else "dops"
    return target_dir / binary_name


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

    installed_binary = _installed_binary_path(flags.install_dir)
    if installed_binary.exists():
        version_completed = subprocess.run(
            [str(installed_binary), "--version"],
            text=True,
            capture_output=True,
            check=False,
        )
        if version_completed.returncode == 0:
            console.print(f"Installed binary: {installed_binary} ({version_completed.stdout.strip()})")
        else:
            console.print(f"Installed binary: {installed_binary}")
    resolved_binary = shutil.which("dops")
    if resolved_binary and Path(resolved_binary).resolve() != installed_binary.resolve():
        console.print(
            "[yellow]Current shell still resolves `dops` to "
            f"{resolved_binary}. Start a new shell or run the installed binary directly.[/yellow]"
        )


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
