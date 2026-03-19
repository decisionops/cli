from __future__ import annotations

import argparse
import unittest
from unittest.mock import MagicMock, patch

from dops.command_groups.operations import run_gate, run_publish


class OperationsTests(unittest.TestCase):
    def test_run_gate_skips_invalid_confidence_without_crashing(self) -> None:
        client = MagicMock()
        client.repo_ref = "acme/backend"
        client.prepare_gate.return_value = {"recordable": True, "confidence": "not-a-number"}
        flags = argparse.Namespace(repo_path=None, task="ship it")
        with patch("dops.command_groups.operations.DopsClient.from_auth", return_value=client):
            with patch("dops.command_groups.operations.resolve_repo_path", return_value=None):
                with patch("dops.command_groups.operations.find_repo_root", return_value=None):
                    with patch("dops.command_groups.operations.with_spinner", side_effect=lambda _label, fn: fn()):
                        with patch("dops.command_groups.operations.emit_diagnostic") as emit:
                            with patch("dops.command_groups.operations.console.print") as print_mock:
                                run_gate(flags)
        emit.assert_called_once()
        rendered = [" ".join(str(arg) for arg in call.args) for call in print_mock.call_args_list]
        self.assertTrue(any("Recordable:" in line for line in rendered))
        self.assertFalse(any("Confidence:" in line for line in rendered))

    def test_run_publish_uses_valid_cli_version(self) -> None:
        client = MagicMock(org_id="org_123", project_id="proj_456")
        client.publish_decision.return_value = {"decision_id": "dec_123", "version": 7}
        flags = argparse.Namespace(repo_path=None, version=7)
        with patch("dops.command_groups.operations.DopsClient.from_auth", return_value=client):
            with patch("dops.command_groups.operations.resolve_repo_path", return_value=None):
                with patch("dops.command_groups.operations.console.print"):
                    run_publish("dec_123", flags)
        client.get_decision.assert_not_called()
        client.publish_decision.assert_called_once()

    def test_run_publish_rejects_invalid_server_version(self) -> None:
        client = MagicMock(org_id="org_123", project_id="proj_456")
        client.get_decision.return_value = {"version": "abc"}
        flags = argparse.Namespace(repo_path=None, version=None)
        with patch("dops.command_groups.operations.DopsClient.from_auth", return_value=client):
            with patch("dops.command_groups.operations.resolve_repo_path", return_value=None):
                with self.assertRaises(RuntimeError) as raised:
                    run_publish("dec_123", flags)
        self.assertIn("DecisionOps decision version must be an integer", str(raised.exception))
