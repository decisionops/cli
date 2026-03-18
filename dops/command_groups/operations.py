from __future__ import annotations

import argparse

from ..api_client import DopsClient
from ..argparse_utils import DopsHelpFormatter, add_examples
from ..git import find_repo_root, git_changed_files, infer_repo_ref, resolve_repo_path
from ..ui import console, prompt_text, with_spinner
from .shared import require_project_binding


def run_gate(flags: argparse.Namespace) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    task_summary = flags.task
    if not task_summary:
        if not console.is_terminal:
            raise RuntimeError("--task is required in non-interactive mode.")
        task_summary = prompt_text(
            title="What task are you working on?",
            placeholder="Describe the task or change...",
            validate=lambda value: None if value else "Task summary is required.",
        )
    repo_ref = client.repo_ref
    if not repo_ref and repo_path:
        try:
            repo_ref = infer_repo_ref(repo_path)
        except Exception:
            repo_ref = None
    if not repo_ref:
        raise RuntimeError("Could not determine repo_ref. Run `dops init` or pass --repo-path inside a configured repo.")
    root = repo_path or find_repo_root() or None
    changed_paths = git_changed_files(root) if root else []
    result = with_spinner("Running decision gate...", lambda: client.prepare_gate(repo_ref, task_summary, changed_paths or None))
    console.print(f"Recordable:  {'yes' if result.get('recordable') else 'no'}")
    confidence = result.get("confidence")
    if confidence is not None:
        console.print(f"Confidence:  {round(float(confidence) * 100):.0f}%")
    if result.get("classification_reason"):
        console.print(f"Reasoning:   {result['classification_reason']}")
    elif result.get("reasoning"):
        console.print(f"Reasoning:   {result['reasoning']}")
    if result.get("suggested_mode"):
        console.print(f"Mode:        {result['suggested_mode']}")


def run_validate(decision_id: str | None, flags: argparse.Namespace) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    org_id, project_id = require_project_binding(client)
    payload = {"org_id": org_id, "project_id": project_id}
    if decision_id:
        payload["decision_id"] = decision_id
    result = with_spinner("Validating decision...", lambda: client.validate_decision(payload))
    console.print(f"Valid: {'yes' if result.get('valid') else 'no'}")
    errors = result.get("errors") or []
    warnings = result.get("warnings") or []
    if errors:
        console.print("Errors:")
        for error in errors:
            console.print(f"  - {error.get('message') if isinstance(error, dict) else error}")
    if warnings:
        console.print("Warnings:")
        for warning in warnings:
            console.print(f"  - {warning.get('message') if isinstance(warning, dict) else warning}")


def run_publish(decision_id: str, flags: argparse.Namespace) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    org_id, project_id = require_project_binding(client)
    expected_version = int(flags.version) if flags.version else None
    if expected_version is None:
        decision = client.get_decision(decision_id)
        if decision.get("version") is None:
            raise RuntimeError("Could not determine current decision version. Pass --version.")
        expected_version = int(decision["version"])
    result = with_spinner(
        "Publishing decision...",
        lambda: client.publish_decision(
            {"org_id": org_id, "project_id": project_id, "decision_id": decision_id, "expected_version": expected_version}
        ),
    )
    console.print(f"Published: {result.get('decision_id', decision_id)} (v{result.get('version', expected_version)})")


def run_status(flags: argparse.Namespace) -> None:
    repo_path = resolve_repo_path(flags.repo_path) or None
    client = DopsClient.from_auth(repo_path)
    snapshot, alerts = with_spinner("Loading governance data...", lambda: (client.get_monitoring_snapshot(), client.get_alerts()))
    console.print("Governance Snapshot")
    console.print(f"  Total decisions: {snapshot.get('totalDecisions', snapshot.get('total_decisions', 'n/a'))}")
    console.print(f"  Coverage:        {snapshot.get('coveragePercent', snapshot.get('coverage_percent', 'n/a'))}%")
    console.print(f"  Health:          {snapshot.get('healthPercent', snapshot.get('health_percent', 'n/a'))}%")
    console.print(f"  Drift rate:      {snapshot.get('driftRate', snapshot.get('drift_rate', 'n/a'))}")
    by_status = snapshot.get("byStatus") or snapshot.get("by_status") or {}
    if isinstance(by_status, dict) and by_status:
        console.print("  By status:")
        for status, count in by_status.items():
            console.print(f"    {status}: {count}")
    if alerts:
        console.print(f"\nAlerts ({len(alerts)}):")
        for alert in alerts:
            console.print(f"  [{alert.get('severity', 'info')}] {alert.get('message', '')}", markup=False)


def register_operation_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    gate = subparsers.add_parser("gate", formatter_class=DopsHelpFormatter, help="Run decision gate on current task", description="Run decision gate on current task")
    gate.add_argument("--task")
    gate.add_argument("--repo-path")
    gate.set_defaults(func=run_gate)
    add_examples(gate, ['dops gate --task "add oauth callback validation"'])

    validate = subparsers.add_parser("validate", formatter_class=DopsHelpFormatter, help="Validate a decision against org constraints", description="Validate a decision against org constraints")
    validate.add_argument("id", nargs="?")
    validate.add_argument("--repo-path")
    validate.set_defaults(func=lambda args: run_validate(args.id, args))
    add_examples(validate, ["dops validate", "dops validate dec_123"])

    publish = subparsers.add_parser("publish", formatter_class=DopsHelpFormatter, help="Publish a proposed decision (transition to accepted)", description="Publish a proposed decision (transition to accepted)")
    publish.add_argument("id")
    publish.add_argument("--version")
    publish.add_argument("--repo-path")
    publish.set_defaults(func=lambda args: run_publish(args.id, args))
    add_examples(publish, ["dops publish dec_123", "dops publish dec_123 --version 7"])

    status = subparsers.add_parser("status", formatter_class=DopsHelpFormatter, help="Governance snapshot: coverage, health, drift, alerts", description="Governance snapshot: coverage, health, drift, alerts")
    status.add_argument("--repo-path")
    status.set_defaults(func=run_status)
    add_examples(status, ["dops status"])
