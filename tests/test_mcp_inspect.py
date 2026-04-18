from __future__ import annotations

import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from dops.mcp_inspect import (
    McpProbeResult,
    _count_tools_in_response,
    inspect_mcp_entry,
    probe_mcp_endpoint,
)

EXPECTED_URL = "https://api.aidecisionops.com/mcp"
SERVER_NAME = "decision-ops-mcp"


class _TempFileMixin(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp_path = Path(self._tmp.name)

    def write(self, name: str, content: str) -> str:
        path = self.tmp_path / name
        path.write_text(content, encoding="utf8")
        return str(path)


class InspectMcpEntryCodexTomlTests(_TempFileMixin):
    def test_missing_file_reports_not_configured(self) -> None:
        report = inspect_mcp_entry(
            config_path=str(self.tmp_path / "config.toml"),
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertFalse(report.config_exists)
        self.assertFalse(report.healthy)
        self.assertTrue(any("not present" in issue for issue in report.issues))

    def test_happy_path(self) -> None:
        path = self.write(
            "config.toml",
            '[mcp_servers.decision-ops-mcp]\nurl = "https://api.aidecisionops.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertTrue(report.healthy)
        self.assertEqual(report.issues, [])
        self.assertEqual(report.short_status(), "ok")

    def test_detects_wrong_url(self) -> None:
        path = self.write(
            "config.toml",
            '[mcp_servers.decision-ops-mcp]\nurl = "https://old.example.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
            platform_id="codex",
        )
        self.assertTrue(report.entry_found)
        self.assertFalse(report.url_matches)
        self.assertFalse(report.healthy)
        self.assertTrue(any("old.example.com" in issue for issue in report.issues))
        self.assertIn("wrong url", report.short_status())
        self.assertTrue(
            any("dops install codex --skip-skill --skip-manifest" in issue for issue in report.issues)
        )

    def test_missing_entry_recommends_mcp_only_install(self) -> None:
        """Doctor should tell users exactly how to fix just the MCP entry
        without re-running skill and manifest work that is already correct."""
        path = self.write("config.toml", '[mcp_servers.other]\nurl = "https://x.example.com"\n')
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
            platform_id="codex",
        )
        self.assertFalse(report.entry_found)
        self.assertTrue(
            any("dops install codex --skip-skill --skip-manifest" in issue for issue in report.issues)
        )

    def test_detects_disabled_entry(self) -> None:
        path = self.write(
            "config.toml",
            '[mcp_servers.decision-ops-mcp]\nenabled = false\nurl = "https://api.aidecisionops.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertTrue(report.entry_found)
        self.assertTrue(report.url_matches)
        self.assertFalse(report.entry_enabled)
        self.assertFalse(report.healthy)
        self.assertTrue(any("disabled" in issue for issue in report.issues))

    def test_flags_competing_entry_pointing_to_expected_url(self) -> None:
        path = self.write(
            "config.toml",
            '[mcp_servers.legacy-decision]\nurl = "https://api.aidecisionops.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertFalse(report.entry_found)
        self.assertEqual(report.competing_entries, ["legacy-decision"])
        self.assertTrue(any("legacy-decision" in issue for issue in report.issues))

    def test_invalid_toml_is_surfaced(self) -> None:
        path = self.write("config.toml", "not = [valid toml")
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertIsNotNone(report.parse_error)
        self.assertFalse(report.healthy)


class InspectMcpEntryJsonMapTests(_TempFileMixin):
    def test_happy_path(self) -> None:
        payload = {"mcpServers": {SERVER_NAME: {"type": "http", "url": EXPECTED_URL}}}
        path = self.write("config.json", json.dumps(payload))
        report = inspect_mcp_entry(
            config_path=path,
            fmt="json_map",
            root_key="mcpServers",
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertTrue(report.healthy)

    def test_disabled_via_disabled_field(self) -> None:
        payload = {"mcpServers": {SERVER_NAME: {"type": "http", "url": EXPECTED_URL, "disabled": True}}}
        path = self.write("config.json", json.dumps(payload))
        report = inspect_mcp_entry(
            config_path=path,
            fmt="json_map",
            root_key="mcpServers",
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertFalse(report.entry_enabled)
        self.assertFalse(report.healthy)

    def test_empty_file_is_surfaced(self) -> None:
        path = self.write("config.json", "")
        report = inspect_mcp_entry(
            config_path=path,
            fmt="json_map",
            root_key="mcpServers",
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        self.assertFalse(report.healthy)
        self.assertTrue(any("empty" in issue.lower() for issue in report.issues))


class CountToolsInResponseTests(unittest.TestCase):
    def test_parses_json_rpc_result(self) -> None:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "a"}, {"name": "b"}]}})
        self.assertEqual(_count_tools_in_response(body), 2)

    def test_parses_sse_data_line(self) -> None:
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "a"}]}})
        body = f"event: message\ndata: {payload}\n\n"
        self.assertEqual(_count_tools_in_response(body), 1)

    def test_empty_or_malformed_returns_zero(self) -> None:
        self.assertEqual(_count_tools_in_response(""), 0)
        self.assertEqual(_count_tools_in_response("not json"), 0)


class ProbeMcpEndpointTests(unittest.TestCase):
    def test_http_401_surfaces_as_auth_error(self) -> None:
        from dops.http import HttpStatusError

        with patch("dops.mcp_inspect.urlopen_with_retries") as mock:
            mock.side_effect = HttpStatusError(
                status=401,
                url="https://api.example.com/mcp",
                headers={},
                body=b'{"error":"Invalid access token"}',
                reason="Unauthorized",
            )
            result = probe_mcp_endpoint(api_base_url="https://api.example.com", token="tok")
        self.assertIsInstance(result, McpProbeResult)
        self.assertEqual(result.status, 401)
        self.assertIn("unauthorized", result.short_status().lower())
        self.assertFalse(result.reachable)

    def test_happy_path_counts_tools(self) -> None:
        body = json.dumps(
            {"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "do-prepare-decision-gate"}]}}
        ).encode("utf8")

        class FakeResponse:
            def __init__(self) -> None:
                self.status = 200
                self.body = body

        with patch("dops.mcp_inspect.urlopen_with_retries", return_value=FakeResponse()):
            result = probe_mcp_endpoint(api_base_url="https://api.example.com", token="tok")
        self.assertTrue(result.reachable)
        self.assertEqual(result.tool_count, 1)

    def test_url_error_reports_unreachable(self) -> None:
        with patch("dops.mcp_inspect.urlopen_with_retries", side_effect=urllib.error.URLError("DNS failure")):
            result = probe_mcp_endpoint(api_base_url="https://api.example.com", token="tok")
        self.assertEqual(result.status, 0)
        self.assertFalse(result.reachable)
        self.assertIn("dns failure", (result.error or "").lower())


if __name__ == "__main__":
    unittest.main()
