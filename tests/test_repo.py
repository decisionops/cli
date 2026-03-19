from __future__ import annotations

import argparse
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dops.command_groups.repo import _organization_options, _project_options, run_init


class RepoCommandTests(unittest.TestCase):
    def test_organization_options_include_name_and_id(self) -> None:
        options = _organization_options(
            {
                "activeOrganization": {"orgId": "org_123", "orgName": "Acme", "role": "admin"},
                "organizations": [{"orgId": "org_123", "orgName": "Acme", "role": "admin"}],
            }
        )
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0].value, "org_123")
        self.assertIn("Acme", options[0].label)

    def test_project_options_filter_by_org(self) -> None:
        options = _project_options(
            {
                "projects": [
                    {"id": "proj_123", "name": "Backend", "projectKey": "backend", "orgId": "org_123"},
                    {"id": "proj_999", "name": "Other", "projectKey": "other", "orgId": "org_999"},
                ]
            },
            "org_123",
        )
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0].value, "proj_123")
        self.assertIn("Backend", options[0].label)

    def test_run_init_uses_workspace_selection_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_path = Path(temp_dir)
            flags = argparse.Namespace(
                repo_path=str(repo_path),
                api_base_url=None,
                org_id=None,
                project_id=None,
                repo_ref="acme/backend",
                repo_id=None,
                default_branch="main",
                user_session_token=None,
                allow_placeholders=False,
                server_name=None,
                server_url=None,
            )
            with patch("dops.command_groups.repo.is_interactive", return_value=True):
                with patch(
                    "dops.command_groups.repo._resolve_binding_from_workspace_context",
                    return_value=("org_123", "proj_123"),
                ):
                    with patch("dops.command_groups.repo.prompt_text") as prompt_text:
                        with patch("dops.command_groups.repo.console.print"):
                            run_init(flags)
            prompt_text.assert_not_called()
            manifest = (repo_path / ".decisionops" / "manifest.toml").read_text(encoding="utf8")
            self.assertIn('org_id = "org_123"', manifest)
            self.assertIn('project_id = "proj_123"', manifest)
