from __future__ import annotations

import unittest

from dops.http import default_user_agent


class HttpTests(unittest.TestCase):
    def test_default_user_agent_looks_like_cli_identifier(self) -> None:
        value = default_user_agent()
        self.assertIn("decisionops-cli/", value)
        self.assertIn("github.com/decisionops/cli", value)
