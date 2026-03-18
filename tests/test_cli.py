from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(REPO_ROOT) if not existing else f"{REPO_ROOT}{os.pathsep}{existing}"
    return subprocess.run(
        [sys.executable, "-m", "dops", *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )


class CliTests(unittest.TestCase):
    def test_root_help(self) -> None:
        result = run_cli("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("dops", result.stdout)
        self.assertIn("usage:", result.stdout)
        self.assertIn("Examples:", result.stdout)
        self.assertIn("dops install --platform codex", result.stdout)

    def test_version(self) -> None:
        result = run_cli("--version")
        self.assertEqual(result.returncode, 0)
        self.assertRegex(result.stdout.strip(), r"^\d+\.\d+\.\d+$")

    def test_login_help_hides_token_flags(self) -> None:
        result = run_cli("login", "--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Authenticate", result.stdout)
        self.assertIn("--api-base-url", result.stdout)
        self.assertNotIn("--with-token", result.stdout)

    def test_install_help_lists_supported_platforms(self) -> None:
        result = run_cli("install", "--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Install DecisionOps skill", result.stdout)
        self.assertIn("--platform", result.stdout)
        self.assertIn("Supported platform ids: codex, claude-code, cursor, vscode, antigravity", result.stdout)
