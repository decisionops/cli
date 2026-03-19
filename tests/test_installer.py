from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from dops.installer import _remove_json_map_server, _upsert_json_map, cleanup_platforms, install_platforms


class InstallerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp(prefix="dops-installer-test-")
        self.repo_path = Path(self.temp_dir) / "repo"
        self.repo_path.mkdir()
        self.platforms_dir = Path(self.temp_dir) / "platforms"
        self.platforms_dir.mkdir()
        (self.platforms_dir / "test.toml").write_text(
            "\n".join(
                [
                    'id = "test"',
                    'display_name = "Test Platform"',
                    "",
                    "[skill]",
                    "supported = true",
                    'install_path_default = "{repo_path}/.skills/{skill_name}"',
                    'build_path = "{skill_name}"',
                    "",
                    "[mcp]",
                    "supported = true",
                    'scope = "project"',
                    'format = "json_map"',
                    'root_key = "mcpServers"',
                    'install_path_default = "{repo_path}/.mcp.json"',
                    "",
                    "[auth]",
                    'mode = "interactive_handoff"',
                    'instructions = ["Enable {display_name}"]',
                    "",
                ]
            ),
            encoding="utf8",
        )
        self.skill_source = Path(self.temp_dir) / "skill"
        self.skill_source.mkdir()
        (self.skill_source / "SKILL.md").write_text("# Demo skill\n", encoding="utf8")

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_install_and_cleanup_round_trip(self) -> None:
        result = install_platforms(
            {
                "platforms_dir": str(self.platforms_dir),
                "selected_platforms": ["test"],
                "skill_name": "decision-ops",
                "source_dir": str(self.skill_source),
                "repo_path": str(self.repo_path),
                "install_skill": True,
                "install_mcp": True,
                "write_manifest": True,
                "org_id": "acme",
                "project_id": "backend",
                "repo_ref": "acme/backend",
                "default_branch": "main",
            }
        )
        self.assertTrue((self.repo_path / ".skills" / "decision-ops" / "SKILL.md").exists())
        self.assertTrue((self.repo_path / ".mcp.json").exists())
        self.assertTrue((self.repo_path / ".decisionops" / "manifest.toml").exists())
        self.assertTrue((self.repo_path / ".decisionops" / "auth-handoff.toml").exists())
        self.assertEqual(result.installed_skills[0]["platformId"], "test")

        cleanup = cleanup_platforms(
            {
                "platforms_dir": str(self.platforms_dir),
                "selected_platforms": ["test"],
                "skill_name": "decision-ops",
                "repo_path": str(self.repo_path),
                "remove_skill": True,
                "remove_mcp": True,
                "remove_manifest": True,
                "remove_auth_handoff": True,
            }
        )
        self.assertFalse((self.repo_path / ".skills" / "decision-ops").exists())
        self.assertFalse((self.repo_path / ".mcp.json").exists())
        self.assertFalse((self.repo_path / ".decisionops" / "manifest.toml").exists())
        self.assertFalse((self.repo_path / ".decisionops" / "auth-handoff.toml").exists())
        self.assertEqual(cleanup.removed_skills[0]["platformId"], "test")

    def test_upsert_json_map_reports_corrupt_existing_file(self) -> None:
        config_path = self.repo_path / ".mcp.json"
        config_path.write_text("{broken", encoding="utf8")
        with self.assertRaises(RuntimeError) as raised:
            _upsert_json_map(str(config_path), "mcpServers", "decision-ops", "https://api.example.com/mcp")
        self.assertIn("Invalid JSON in MCP config", str(raised.exception))

    def test_remove_json_map_server_reports_corrupt_existing_file(self) -> None:
        config_path = self.repo_path / ".mcp.json"
        config_path.write_text("{broken", encoding="utf8")
        with self.assertRaises(RuntimeError) as raised:
            _remove_json_map_server(str(config_path), "mcpServers", "decision-ops")
        self.assertIn("Invalid JSON in MCP config", str(raised.exception))
