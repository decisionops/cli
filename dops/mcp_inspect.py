"""Verify IDE MCP configs and probe the DecisionOps MCP endpoint.

Catches the "installed but wrong" class of failures where `dops install`
thinks everything is fine because files exist, but the IDE is actually
pointing at a stale URL, has the entry disabled, or can't reach the
remote MCP server with the current auth.
"""

from __future__ import annotations

import json
import socket
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from .http import HttpStatusError, default_user_agent, urlopen_with_retries
from .tls import create_ssl_context


@dataclass
class McpEntryReport:
    """Diagnostic for a single IDE's MCP config entry.

    `issues` is the human-readable rollup; callers feed it into the
    doctor report so users see concrete "what to do next" text rather
    than having to interpret structured fields.
    """

    config_path: str
    format: str
    server_name: str
    expected_url: str
    config_exists: bool
    parse_error: str | None = None
    entry_found: bool = False
    entry_url: str | None = None
    entry_enabled: bool | None = None
    url_matches: bool = False
    competing_entries: list[str] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)

    @property
    def healthy(self) -> bool:
        return (
            self.config_exists
            and self.parse_error is None
            and self.entry_found
            and self.url_matches
            and self.entry_enabled is not False
        )

    def short_status(self) -> str:
        if not self.config_exists:
            return "not configured"
        if self.parse_error:
            return "parse error"
        if not self.entry_found:
            return "entry missing"
        if not self.url_matches:
            return f"wrong url ({self.entry_url})"
        if self.entry_enabled is False:
            return "disabled"
        return "ok"


def _mcp_only_install_command(platform_id: str | None) -> str:
    """Tell users exactly how to fix a missing/wrong MCP entry without
    re-running skill and manifest work that is probably already correct.

    The existing `--skip-skill --skip-manifest` flags on `dops install`
    already do this; doctor just needs to point at the right incantation
    with the platform name baked in.
    """
    target = platform_id or "<platform>"
    return f"dops install {target} --skip-skill --skip-manifest"


def inspect_mcp_entry(
    *,
    config_path: str,
    fmt: str,
    root_key: str | None,
    server_name: str,
    expected_url: str,
    platform_id: str | None = None,
) -> McpEntryReport:
    report = McpEntryReport(
        config_path=config_path,
        format=fmt,
        server_name=server_name,
        expected_url=expected_url,
        config_exists=Path(config_path).exists(),
    )
    fix_hint = _mcp_only_install_command(platform_id)
    if not report.config_exists:
        report.issues.append(
            f"MCP config not present at {config_path}. Run `{fix_hint}`."
        )
        return report
    try:
        raw = Path(config_path).read_text(encoding="utf8")
    except (OSError, UnicodeDecodeError) as error:
        report.parse_error = f"Cannot read {config_path}: {error}"
        report.issues.append(report.parse_error)
        return report

    if fmt == "codex_toml":
        _inspect_codex_toml(raw, report)
    elif fmt == "json_map":
        _inspect_json_map(raw, root_key or "mcpServers", report)
    else:
        report.issues.append(f"Unsupported MCP config format: {fmt}")
        return report

    if report.entry_found:
        if not report.url_matches:
            report.issues.append(
                f"MCP entry `{server_name}` in {config_path} points to {report.entry_url}, "
                f"expected {expected_url}. Run `{fix_hint}` to repair."
            )
        if report.entry_enabled is False:
            # Reinstall is still the quickest remediation — the new writer
            # replaces the block with a minimal `url = "..."` entry, which
            # defaults to enabled in every supported IDE.
            report.issues.append(
                f"MCP entry `{server_name}` in {config_path} is disabled. Run `{fix_hint}` "
                "to rewrite the entry, or flip `enabled = true` by hand."
            )
    else:
        suffix = ""
        if report.competing_entries:
            suffix = (
                f" Another entry ({', '.join(report.competing_entries)}) already points to "
                f"{expected_url}; consider removing it to avoid confusion."
            )
        report.issues.append(
            f"MCP entry `{server_name}` missing from {config_path}. Run `{fix_hint}`.{suffix}"
        )
    return report


def _normalize_url(value: str | None) -> str:
    return (value or "").rstrip("/")


def _inspect_codex_toml(raw: str, report: McpEntryReport) -> None:
    try:
        data = tomllib.loads(raw)
    except tomllib.TOMLDecodeError as error:
        report.parse_error = f"Invalid TOML: {error}"
        report.issues.append(report.parse_error)
        return
    servers = data.get("mcp_servers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        report.issues.append("`mcp_servers` table is missing or malformed")
        return
    expected = _normalize_url(report.expected_url)
    for name, candidate in servers.items():
        if not isinstance(candidate, dict):
            continue
        if name == report.server_name:
            report.entry_found = True
            url = candidate.get("url")
            report.entry_url = str(url) if url else None
            if "enabled" in candidate:
                report.entry_enabled = bool(candidate.get("enabled"))
            else:
                report.entry_enabled = True
            report.url_matches = _normalize_url(report.entry_url) == expected
        elif _normalize_url(str(candidate.get("url", ""))) == expected:
            report.competing_entries.append(str(name))


def _inspect_json_map(raw: str, root_key: str, report: McpEntryReport) -> None:
    stripped = raw.strip()
    if not stripped:
        report.issues.append(f"Config file is empty; no `{root_key}` block")
        return
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as error:
        report.parse_error = f"Invalid JSON: {error}"
        report.issues.append(report.parse_error)
        return
    root = data.get(root_key) if isinstance(data, dict) else None
    if not isinstance(root, dict):
        report.issues.append(f"`{root_key}` block is missing or not an object")
        return
    expected = _normalize_url(report.expected_url)
    for name, candidate in root.items():
        if not isinstance(candidate, dict):
            continue
        if name == report.server_name:
            report.entry_found = True
            url = candidate.get("url")
            report.entry_url = str(url) if url else None
            if "disabled" in candidate:
                report.entry_enabled = not bool(candidate.get("disabled"))
            elif "enabled" in candidate:
                report.entry_enabled = bool(candidate.get("enabled"))
            else:
                report.entry_enabled = True
            report.url_matches = _normalize_url(report.entry_url) == expected
        elif _normalize_url(str(candidate.get("url", ""))) == expected:
            report.competing_entries.append(str(name))


@dataclass
class ApiAuthProbeResult:
    """Does the CLI's stored token actually authenticate with the API?

    Hits a cheap REST endpoint the CLI token is *supposed* to work with
    (`/v1/auth/me`). Separate from the MCP endpoint, which uses a
    different audience — see `McpReachabilityResult` below.
    """

    status: int
    error: str | None = None

    @property
    def reachable(self) -> bool:
        return self.status == 200 and self.error is None

    def short_status(self) -> str:
        if self.reachable:
            return "ok"
        if self.status == 401:
            return "unauthorized — run `dops login --force`"
        if self.status == 403:
            return "forbidden — token missing required scope; run `dops login --force`"
        if self.status == 0:
            return f"unreachable — {self.error}"
        return f"error {self.status}: {self.error}"


@dataclass
class McpReachabilityResult:
    """Is the MCP server process up and responding?

    CLI tokens cannot authenticate against `/mcp` (different OAuth
    audience — IDE MCP clients obtain their own tokens via the
    protected-resource flow), so we probe without auth and treat a
    401 "Missing bearer token" response as proof the server is alive.
    """

    status: int
    error: str | None = None

    @property
    def reachable(self) -> bool:
        # A 401 with the "missing bearer token" shape is the expected
        # response for an unauthenticated probe — it means the server
        # handler is alive and enforcing auth.
        return self.status in (200, 401) and self.error is None

    def short_status(self) -> str:
        if self.reachable:
            return "server reachable (IDE MCP client handles its own auth)"
        if self.status == 0:
            return f"unreachable — {self.error}"
        return f"unexpected status {self.status}: {self.error}"


def probe_api_auth(*, api_base_url: str, token: str, path: str = "/v1/auth/me", timeout: int = 10) -> ApiAuthProbeResult:
    url = f"{api_base_url.rstrip('/')}{path}"
    headers = {
        "accept": "application/json",
        "authorization": f"Bearer {token}",
        "user-agent": default_user_agent(),
    }
    request = urllib.request.Request(url, method="GET", headers=headers)
    try:
        response = urlopen_with_retries(request, timeout=timeout, context=create_ssl_context())
    except HttpStatusError as error:
        message = _read_error_message(error)
        return ApiAuthProbeResult(status=error.status, error=message)
    except socket.timeout:
        return ApiAuthProbeResult(status=0, error=f"timeout after {timeout}s")
    except urllib.error.URLError as error:
        return ApiAuthProbeResult(status=0, error=str(error.reason))
    return ApiAuthProbeResult(status=response.status, error=None)


def probe_mcp_reachability(*, mcp_url: str, timeout: int = 10) -> McpReachabilityResult:
    headers = {
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "user-agent": default_user_agent(),
    }
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode("utf8")
    request = urllib.request.Request(mcp_url, data=body, method="POST", headers=headers)
    try:
        response = urlopen_with_retries(request, timeout=timeout, context=create_ssl_context())
    except HttpStatusError as error:
        # 401 with "Missing bearer token" is the happy path here — it
        # means the server is up and the auth middleware is running.
        if error.status == 401:
            return McpReachabilityResult(status=401, error=None)
        return McpReachabilityResult(status=error.status, error=_read_error_message(error))
    except socket.timeout:
        return McpReachabilityResult(status=0, error=f"timeout after {timeout}s")
    except urllib.error.URLError as error:
        return McpReachabilityResult(status=0, error=str(error.reason))
    return McpReachabilityResult(status=response.status, error=None)


def _read_error_message(error: HttpStatusError) -> str:
    raw = error.body.decode("utf8") if error.body else ""
    try:
        payload = json.loads(raw)
        return str(payload.get("error") or payload.get("message") or error.reason)
    except json.JSONDecodeError:
        return raw or str(error.reason)


