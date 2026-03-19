from __future__ import annotations

import unittest
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
