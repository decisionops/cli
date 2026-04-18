from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from dops.mcp_inspect import (
    McpProbeResult,
    _count_tools_in_response,
    inspect_mcp_entry,
    probe_mcp_endpoint,
)

EXPECTED_URL = "https://api.aidecisionops.com/mcp"
SERVER_NAME = "decision-ops-mcp"


def _write(tmp_path: Path, name: str, content: str) -> str:
    path = tmp_path / name
    path.write_text(content, encoding="utf8")
    return str(path)


class TestInspectMcpEntryCodexToml:
    def test_missing_file_reports_not_configured(self, tmp_path: Path) -> None:
        report = inspect_mcp_entry(
            config_path=str(tmp_path / "config.toml"),
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert not report.config_exists
        assert not report.healthy
        assert any("not present" in issue for issue in report.issues)

    def test_happy_path(self, tmp_path: Path) -> None:
        path = _write(
            tmp_path,
            "config.toml",
            '[mcp_servers.decision-ops-mcp]\ntype = "http"\nenabled = true\nurl = "https://api.aidecisionops.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert report.healthy
        assert report.issues == []
        assert report.short_status() == "ok"

    def test_detects_wrong_url(self, tmp_path: Path) -> None:
        path = _write(
            tmp_path,
            "config.toml",
            '[mcp_servers.decision-ops-mcp]\ntype = "http"\nenabled = true\nurl = "https://old.example.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
            platform_id="codex",
        )
        assert report.entry_found
        assert not report.url_matches
        assert not report.healthy
        assert any("old.example.com" in issue for issue in report.issues)
        assert "wrong url" in report.short_status()
        assert any("dops install codex --skip-skill --skip-manifest" in issue for issue in report.issues)

    def test_missing_entry_recommends_mcp_only_install(self, tmp_path: Path) -> None:
        """Doctor should tell users exactly how to fix just the MCP entry
        without re-running skill and manifest work that is already correct."""
        path = _write(tmp_path, "config.toml", '[mcp_servers.other]\nurl = "https://x.example.com"\n')
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
            platform_id="codex",
        )
        assert not report.entry_found
        assert any("dops install codex --skip-skill --skip-manifest" in issue for issue in report.issues)

    def test_detects_disabled_entry(self, tmp_path: Path) -> None:
        path = _write(
            tmp_path,
            "config.toml",
            '[mcp_servers.decision-ops-mcp]\ntype = "http"\nenabled = false\nurl = "https://api.aidecisionops.com/mcp"\n',
        )
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert report.entry_found
        assert report.url_matches
        assert report.entry_enabled is False
        assert not report.healthy
        assert any("disabled" in issue for issue in report.issues)

    def test_flags_competing_entry_pointing_to_expected_url(self, tmp_path: Path) -> None:
        path = _write(
            tmp_path,
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
        assert not report.entry_found
        assert report.competing_entries == ["legacy-decision"]
        assert any("legacy-decision" in issue for issue in report.issues)

    def test_invalid_toml_is_surfaced(self, tmp_path: Path) -> None:
        path = _write(tmp_path, "config.toml", "not = [valid toml")
        report = inspect_mcp_entry(
            config_path=path,
            fmt="codex_toml",
            root_key=None,
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert report.parse_error is not None
        assert not report.healthy


class TestInspectMcpEntryJsonMap:
    def test_happy_path(self, tmp_path: Path) -> None:
        payload = {
            "mcpServers": {
                SERVER_NAME: {"type": "http", "url": EXPECTED_URL},
            }
        }
        path = _write(tmp_path, "config.json", json.dumps(payload))
        report = inspect_mcp_entry(
            config_path=path,
            fmt="json_map",
            root_key="mcpServers",
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert report.healthy

    def test_disabled_via_disabled_field(self, tmp_path: Path) -> None:
        payload = {
            "mcpServers": {
                SERVER_NAME: {"type": "http", "url": EXPECTED_URL, "disabled": True},
            }
        }
        path = _write(tmp_path, "config.json", json.dumps(payload))
        report = inspect_mcp_entry(
            config_path=path,
            fmt="json_map",
            root_key="mcpServers",
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert report.entry_enabled is False
        assert not report.healthy

    def test_empty_file_is_surfaced(self, tmp_path: Path) -> None:
        path = _write(tmp_path, "config.json", "")
        report = inspect_mcp_entry(
            config_path=path,
            fmt="json_map",
            root_key="mcpServers",
            server_name=SERVER_NAME,
            expected_url=EXPECTED_URL,
        )
        assert not report.healthy
        assert any("empty" in issue.lower() for issue in report.issues)


class TestCountToolsInResponse:
    def test_parses_json_rpc_result(self) -> None:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "a"}, {"name": "b"}]}})
        assert _count_tools_in_response(body) == 2

    def test_parses_sse_data_line(self) -> None:
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "a"}]}})
        body = f"event: message\ndata: {payload}\n\n"
        assert _count_tools_in_response(body) == 1

    def test_empty_or_malformed_returns_zero(self) -> None:
        assert _count_tools_in_response("") == 0
        assert _count_tools_in_response("not json") == 0


class TestProbeMcpEndpoint:
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
        assert isinstance(result, McpProbeResult)
        assert result.status == 401
        assert "unauthorized" in result.short_status().lower()
        assert not result.reachable

    def test_happy_path_counts_tools(self) -> None:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "do-prepare-decision-gate"}]}}).encode("utf8")

        class FakeResponse:
            def __init__(self) -> None:
                self.status = 200
                self.body = body

        with patch("dops.mcp_inspect.urlopen_with_retries", return_value=FakeResponse()):
            result = probe_mcp_endpoint(api_base_url="https://api.example.com", token="tok")
        assert result.reachable
        assert result.tool_count == 1

    def test_url_error_reports_unreachable(self) -> None:
        import urllib.error

        with patch("dops.mcp_inspect.urlopen_with_retries", side_effect=urllib.error.URLError("DNS failure")):
            result = probe_mcp_endpoint(api_base_url="https://api.example.com", token="tok")
        assert result.status == 0
        assert not result.reachable
        assert "dns failure" in (result.error or "").lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
