from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dops.api_client import DecisionOpsApiError, DopsClient
from dops.http import HttpResponse, HttpStatusError


class ApiClientTests(unittest.TestCase):
    def test_request_returns_json_payload(self) -> None:
        client = DopsClient(api_base_url="https://api.example.com", token="dop_token")
        with patch(
            "dops.api_client.urlopen_with_retries",
            return_value=HttpResponse(
                url="https://api.example.com/v1/auth/me",
                status=200,
                headers={"content-type": "application/json"},
                body=b'{"ok": true}',
            ),
        ):
            self.assertEqual(client.request("GET", "/v1/auth/me"), {"ok": True})

    def test_request_wraps_auth_failures_with_relogin_message(self) -> None:
        client = DopsClient(api_base_url="https://api.example.com", token="dop_token")
        with patch(
            "dops.api_client.urlopen_with_retries",
            side_effect=HttpStatusError(
                401,
                "https://api.example.com/v1/auth/me",
                {"content-type": "application/json"},
                b'{"message":"expired"}',
                "Unauthorized",
            ),
        ):
            with self.assertRaises(DecisionOpsApiError) as raised:
                client.request("GET", "/v1/auth/me")
        self.assertEqual(raised.exception.status, 401)
        self.assertIn("Run `dops login`", str(raised.exception))

    def test_request_reports_missing_scope_with_force_relogin_message(self) -> None:
        client = DopsClient(api_base_url="https://api.example.com", token="dop_token")
        with patch(
            "dops.api_client.urlopen_with_retries",
            side_effect=HttpStatusError(
                403,
                "https://api.example.com/v1/admin/projects/proj_123/repositories",
                {"content-type": "application/json"},
                b'{"message":"Missing scope: admin:write"}',
                "Forbidden",
            ),
        ):
            with self.assertRaises(DecisionOpsApiError) as raised:
                client.request("POST", "/v1/admin/projects/proj_123/repositories", {"repoId": "acme/backend"})
        self.assertEqual(raised.exception.status, 403)
        self.assertIn("Run `dops login --force`", str(raised.exception))
        self.assertIn("Missing scope: admin:write", str(raised.exception))

    def test_request_reports_invalid_json_on_success(self) -> None:
        client = DopsClient(api_base_url="https://api.example.com", token="dop_token")
        with patch(
            "dops.api_client.urlopen_with_retries",
            return_value=HttpResponse(
                url="https://api.example.com/v1/auth/me",
                status=200,
                headers={"content-type": "application/json"},
                body=b"{broken",
            ),
        ):
            with self.assertRaises(DecisionOpsApiError) as raised:
                client.request("GET", "/v1/auth/me")
        self.assertIn("invalid JSON", str(raised.exception))

    def test_create_project_returns_project_payload(self) -> None:
        client = DopsClient(api_base_url="https://api.example.com", token="dop_token")
        with patch.object(
            DopsClient,
            "request",
            return_value={"ok": True, "project": {"id": "proj_123", "name": "Payments Platform"}},
        ) as request:
            self.assertEqual(
                client.create_project("Payments Platform", set_default=False),
                {"id": "proj_123", "name": "Payments Platform"},
            )
        request.assert_called_once_with("POST", "/v1/projects", {"name": "Payments Platform", "setDefault": False})

    def test_create_organization_returns_organization_payload(self) -> None:
        client = DopsClient(api_base_url="https://api.example.com", token="dop_token")
        with patch.object(
            DopsClient,
            "request",
            return_value={"ok": True, "organization": {"orgId": "org_123", "orgName": "Acme"}},
        ) as request:
            self.assertEqual(
                client.create_organization("Acme", auto_generate_service_token=False),
                {"orgId": "org_123", "orgName": "Acme"},
            )
        request.assert_called_once_with(
            "POST",
            "/v1/orgs",
            {"name": "Acme", "autoGenerateServiceToken": False},
        )

    def test_from_auth_reports_invalid_manifest_with_repair_guidance(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            decisionops_dir = Path(temp_dir) / ".decisionops"
            decisionops_dir.mkdir(parents=True, exist_ok=True)
            (decisionops_dir / "manifest.toml").write_text("version = [\n", encoding="utf8")
            with patch("dops.api_client.read_auth_state", return_value=object()):
                with patch(
                    "dops.api_client.ensure_valid_auth_state",
                    return_value=type("Auth", (), {"apiBaseUrl": "https://api.example.com", "accessToken": "dop_token"})(),
                ):
                    with self.assertRaises(RuntimeError) as raised:
                        DopsClient.from_auth(temp_dir)
        self.assertIn("Repository manifest is invalid", str(raised.exception))
        self.assertIn(".decisionops/manifest.toml", str(raised.exception))
        self.assertIn("dops init", str(raised.exception))
