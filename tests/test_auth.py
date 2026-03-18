from __future__ import annotations

import os
import shutil
import stat
import tempfile
import unittest

from dops.auth import AuthState, clear_auth_state, is_expired, read_auth_state, save_token_auth_state, write_auth_state


class AuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.mkdtemp(prefix="dops-auth-test-")
        self.original_home = os.environ.get("DECISIONOPS_HOME")
        os.environ["DECISIONOPS_HOME"] = self.tmp_dir

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)
        if self.original_home is None:
            os.environ.pop("DECISIONOPS_HOME", None)
        else:
            os.environ["DECISIONOPS_HOME"] = self.original_home

    def make_auth_state(self, **overrides) -> AuthState:
        data = {
            "apiBaseUrl": "https://api.example.com",
            "issuerUrl": "https://auth.example.com/oauth",
            "clientId": "test-client",
            "scopes": ["mcp:read"],
            "tokenType": "Bearer",
            "accessToken": "test-token-abc",
            "issuedAt": "2026-01-01T00:00:00Z",
            "method": "token",
        }
        data.update(overrides)
        return AuthState(**data)

    def test_round_trips_auth_state(self) -> None:
        state = self.make_auth_state()
        write_auth_state(state)
        loaded = read_auth_state()
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded.accessToken, "test-token-abc")
        self.assertEqual(loaded.apiBaseUrl, "https://api.example.com")
        self.assertEqual(loaded.method, "token")

    def test_auth_file_permissions_are_restricted(self) -> None:
        path = write_auth_state(self.make_auth_state())
        mode = os.stat(path).st_mode & 0o777
        self.assertEqual(mode, stat.S_IRUSR | stat.S_IWUSR)

    def test_clear_auth_state_removes_file(self) -> None:
        path = write_auth_state(self.make_auth_state())
        self.assertTrue(os.path.exists(path))
        clear_auth_state()
        self.assertFalse(os.path.exists(path))

    def test_is_expired_respects_skew(self) -> None:
        self.assertTrue(is_expired(self.make_auth_state(expiresAt="2020-01-01T00:00:00Z")))
        self.assertFalse(is_expired(self.make_auth_state(expiresAt="2099-01-01T00:00:00Z")))

    def test_save_token_auth_state_round_trips(self) -> None:
        state, storage_path = save_token_auth_state(token="my-api-token")
        self.assertEqual(state.accessToken, "my-api-token")
        self.assertTrue(os.path.exists(storage_path))
        loaded = read_auth_state()
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded.accessToken, "my-api-token")
