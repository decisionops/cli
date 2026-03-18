from __future__ import annotations

import argparse
from typing import Any

from ..api_client import DopsClient
from ..argparse_utils import DopsHelpFormatter, add_examples
from ..git import resolve_repo_path
from ..ui import SelectOption, console, prompt_select, prompt_text, reset_flow_state
from .shared import decision_id


def _client_from_flags(flags: argparse.Namespace) -> DopsClient:
    return DopsClient.from_auth(resolve_repo_path(flags.repo_path) or None)


def run_decisions_list(flags: argparse.Namespace) -> None:
    client = _client_from_flags(flags)
    decisions = client.list_decisions({"status": flags.status, "type": flags.type, "limit": int(flags.limit or 20)})
    if not decisions:
        console.print("No decisions found.")
        return
    for decision in decisions:
        status = str(decision.get("status") or "–").ljust(12)
        decision_type = str(decision.get("type") or "–").ljust(12)
        title = str(decision.get("title") or "–")
        console.print(f"{decision_id(decision)}  {status}  {decision_type}  {title}")


def run_decisions_get(decision_id_value: str, flags: argparse.Namespace) -> None:
    client = _client_from_flags(flags)
    decision = client.get_decision(decision_id_value)
    console.print(f"ID:       {decision_id(decision)}")
    console.print(f"Title:    {decision.get('title')}")
    console.print(f"Status:   {decision.get('status')}")
    console.print(f"Type:     {decision.get('type')}")
    console.print(f"Version:  {decision.get('version')}")
    if decision.get("context"):
        console.print(f"Context:  {decision.get('context')}")
    if decision.get("outcome"):
        console.print(f"Outcome:  {decision.get('outcome')}")
    if decision.get("options"):
        console.print("Options:")
        for option in decision["options"]:
            console.print(f"  - {option.get('name')}{': ' + option.get('description') if option.get('description') else ''}")
            if option.get("pros"):
                console.print(f"    Pros: {', '.join(option['pros'])}")
            if option.get("cons"):
                console.print(f"    Cons: {', '.join(option['cons'])}")
    if decision.get("consequences"):
        console.print("Consequences:")
        for consequence in decision["consequences"]:
            console.print(f"  - {consequence}")
    if decision.get("createdAt"):
        console.print(f"Created:  {decision.get('createdAt')}")
    if decision.get("updatedAt"):
        console.print(f"Updated:  {decision.get('updatedAt')}")


def run_decisions_search(terms: str, flags: argparse.Namespace) -> None:
    client = _client_from_flags(flags)
    result = client.search_decisions(terms, {"mode": flags.mode} if flags.mode else None)
    decisions = result.get("decisions", []) if isinstance(result, dict) else []
    total = int(result.get("total", len(decisions))) if isinstance(result, dict) else len(decisions)
    if not decisions:
        console.print("No matching decisions found.")
        return
    console.print(f"Found {total} result{'s' if total != 1 else ''}:")
    for decision in decisions:
        console.print(f"  {decision_id(decision)}  {str(decision.get('status', '')).ljust(12)}  {decision.get('title')}")


def run_decisions_create(flags: argparse.Namespace) -> None:
    reset_flow_state()
    client = _client_from_flags(flags)
    title = prompt_text(title="Decision title", placeholder="What decision are you recording?", validate=lambda value: None if value else "Title is required.")
    decision_type = prompt_select(
        "Decision type",
        [
            SelectOption("Technical", "technical", "Architecture, tooling, infrastructure"),
            SelectOption("Product", "product", "Features, UX, roadmap"),
            SelectOption("Business", "business", "Strategy, process, organization"),
            SelectOption("Governance", "governance", "Policies, standards, compliance"),
        ],
    )
    context = prompt_text(title="Context (what prompted this decision?)", placeholder="Describe the situation...")
    result = client.create_decision({"title": title, "type": decision_type, "context": context or None})
    decision = result.get("decision", result) if isinstance(result, dict) else {}
    console.print(f"Created decision: {decision_id(decision)} (v{decision.get('version', '?')})")


def register_decision_commands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    decisions = subparsers.add_parser("decisions", formatter_class=DopsHelpFormatter, help="Work with decisions", description="Work with decisions")
    decisions_subparsers = decisions.add_subparsers(dest="decisions_command")
    add_examples(decisions, ["dops decisions list", "dops decisions get dec_123", "dops decisions search auth onboarding", "dops decisions create"])

    decisions_list = decisions_subparsers.add_parser("list", formatter_class=DopsHelpFormatter, help="List decisions", description="List decisions")
    decisions_list.add_argument("--status")
    decisions_list.add_argument("--type")
    decisions_list.add_argument("--limit", default="20")
    decisions_list.add_argument("--repo-path")
    decisions_list.set_defaults(func=run_decisions_list)

    decisions_get = decisions_subparsers.add_parser("get", formatter_class=DopsHelpFormatter, help="Get a decision by ID", description="Get a decision by ID")
    decisions_get.add_argument("id")
    decisions_get.add_argument("--repo-path")
    decisions_get.set_defaults(func=lambda args: run_decisions_get(args.id, args))

    decisions_search = decisions_subparsers.add_parser("search", formatter_class=DopsHelpFormatter, help="Search decisions by keywords", description="Search decisions by keywords")
    decisions_search.add_argument("terms", nargs="+")
    decisions_search.add_argument("--mode")
    decisions_search.add_argument("--repo-path")
    decisions_search.set_defaults(func=lambda args: run_decisions_search(" ".join(args.terms), args))

    decisions_create = decisions_subparsers.add_parser("create", formatter_class=DopsHelpFormatter, help="Create a new decision (interactive)", description="Create a new decision (interactive)")
    decisions_create.add_argument("--repo-path")
    decisions_create.set_defaults(func=run_decisions_create)
