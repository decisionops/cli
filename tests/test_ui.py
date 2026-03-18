from __future__ import annotations

import unittest

from dops.ui import SelectOption, _resolve_confirm_value, _resolve_select_value


class UiTests(unittest.TestCase):
    def test_resolve_select_value_accepts_index_label_and_value(self) -> None:
        options = [
            SelectOption(label="Codex", value="codex"),
            SelectOption(label="Claude Code", value="claude-code"),
        ]

        self.assertEqual(_resolve_select_value("1", options), "codex")
        self.assertEqual(_resolve_select_value("claude-code", options), "claude-code")
        self.assertEqual(_resolve_select_value("Codex", options), "codex")

    def test_resolve_confirm_value_handles_default_and_yes_no(self) -> None:
        self.assertTrue(_resolve_confirm_value("", True))
        self.assertFalse(_resolve_confirm_value("", False))
        self.assertTrue(_resolve_confirm_value("y", False))
        self.assertFalse(_resolve_confirm_value("no", True))
        self.assertIsNone(_resolve_confirm_value("maybe", True))
