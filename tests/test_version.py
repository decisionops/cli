from __future__ import annotations

import unittest
from unittest.mock import patch

from dops import _version


class VersionTests(unittest.TestCase):
    def test_resolve_version_prefers_default_before_stale_metadata(self) -> None:
        with patch("dops._version._version_from_build_file", return_value=None):
            with patch("dops._version._version_from_git", return_value=None):
                with patch("dops._version._version_from_metadata", return_value="0.1.0"):
                    with patch("dops._version.DEFAULT_VERSION", "0.1.11"):
                        self.assertEqual(_version.resolve_version(), "0.1.11")
