from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Any, Callable, Generic, Iterable, TypeVar

from prompt_toolkit import prompt
from prompt_toolkit.shortcuts import radiolist_dialog, yes_no_dialog
from prompt_toolkit.validation import ValidationError, Validator
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

T = TypeVar("T")


def _force_terminal() -> bool | None:
    if os.environ.get("FORCE_COLOR"):
        return True
    if os.environ.get("NO_COLOR"):
        return False
    return None


console = Console(stderr=False, force_terminal=_force_terminal(), no_color=bool(os.environ.get("NO_COLOR")))
error_console = Console(stderr=True, force_terminal=_force_terminal(), no_color=bool(os.environ.get("NO_COLOR")))

_prompt_count = 0


class CancelledError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Cancelled.")


@dataclass(slots=True)
class SelectOption(Generic[T]):
    label: str
    value: T
    description: str | None = None


@dataclass(slots=True)
class PromptChrome:
    eyebrow: str | None = None
    description: str | None = None
    footer: str | None = None
    show_brand_header: bool = True


def reset_flow_state() -> None:
    global _prompt_count
    _prompt_count = 0


def flow_chrome(chrome: PromptChrome | None = None) -> PromptChrome:
    global _prompt_count
    is_first = _prompt_count == 0
    _prompt_count += 1
    chrome = chrome or PromptChrome()
    return PromptChrome(
        eyebrow=chrome.eyebrow,
        description=chrome.description,
        footer=chrome.footer,
        show_brand_header=is_first,
    )


def _render_prompt_header(title: str, chrome: PromptChrome | None = None) -> None:
    chrome = chrome or PromptChrome()
    if chrome.show_brand_header:
        heading = Text("DecisionOps", style="bold cyan")
        heading.append(" CLI", style="dim")
        if chrome.eyebrow:
            console.print(Panel.fit(heading, subtitle=chrome.eyebrow, border_style="cyan"))
        else:
            console.print(Panel.fit(heading, border_style="cyan"))
    body = Text(title, style="bold")
    if chrome.description:
        body.append(f"\n{chrome.description}", style="dim")
    if chrome.footer:
        body.append(f"\n{chrome.footer}", style="dim")
    console.print(Panel.fit(body, border_style="cyan"))


def _ensure_interactive() -> None:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise RuntimeError("Interactive terminal required.")


def prompt_select(title: str, options: list[SelectOption[T]], chrome: PromptChrome | None = None) -> T:
    _ensure_interactive()
    _render_prompt_header(title, chrome)
    values = []
    for option in options:
        label = option.label if not option.description else f"{option.label} — {option.description}"
        values.append((option.value, label))
    try:
        result = radiolist_dialog(title="Select", text=title, values=values, ok_text="Choose", cancel_text="Cancel").run()
    except (EOFError, KeyboardInterrupt) as error:
        raise CancelledError() from error
    if result is None:
        raise CancelledError()
    return result


def prompt_confirm(title: str, default_value: bool = True, chrome: PromptChrome | None = None) -> bool:
    _ensure_interactive()
    _render_prompt_header(title, chrome)
    try:
        result = yes_no_dialog(title="Confirm", text=title, yes_text="Yes", no_text="No").run()
    except (EOFError, KeyboardInterrupt) as error:
        raise CancelledError() from error
    if result is None:
        raise CancelledError()
    return bool(result) if result is not None else default_value


def prompt_text(
    *,
    title: str,
    chrome: PromptChrome | None = None,
    default_value: str | None = None,
    placeholder: str | None = None,
    secret: bool = False,
    validate: Callable[[str], str | None] | None = None,
) -> str:
    _ensure_interactive()
    _render_prompt_header(title, chrome)

    class _PromptValidator(Validator):
        def validate(self, document) -> None:
            if validate is None:
                return
            value = document.text.strip() or (default_value or "").strip()
            error = validate(value)
            if error:
                raise ValidationError(message=error, cursor_position=len(document.text))

    try:
        value = prompt(
            "> ",
            default=default_value or "",
            is_password=secret,
            validator=_PromptValidator(),
            validate_while_typing=False,
            placeholder=placeholder or "",
        )
    except (EOFError, KeyboardInterrupt) as error:
        raise CancelledError() from error
    normalized = value.strip()
    return normalized if normalized else (default_value or "").strip()


def with_spinner(label: str, fn: Callable[[], T]) -> T:
    if sys.stdout.isatty():
        with console.status(f"[cyan]{label}[/cyan]"):
            return fn()
    return fn()


def run_login_flow(*, client_display: str, login_with_browser: Callable[[Callable[[str], None]], Any]) -> Any:
    _ensure_interactive()
    printed_url = False

    def on_authorize_url(url: str) -> None:
        nonlocal printed_url
        if printed_url:
            return
        printed_url = True
        console.print(
            Panel.fit(
                Text.from_markup(
                    f"[bold]Browser authentication[/bold]\n\nOpen this URL in your browser to continue:\n[cyan]{url}[/cyan]\n\n[dim]OAuth client: {client_display}[/dim]"
                ),
                border_style="cyan",
                title="Auth",
            )
        )

    return with_spinner("Waiting for browser authentication...", lambda: login_with_browser(on_authorize_url))


def _section_title(title: str) -> None:
    console.print(f"\n[bold cyan]{title}[/bold cyan]")


def render_install_summary(result) -> None:
    _section_title("Install summary")
    if result.manifest_path:
        suffix = " (placeholder)" if result.placeholders_used else ""
        console.print(f"[green]✓[/green] Manifest{suffix}: {result.manifest_path}")
    for entry in result.installed_skills:
        console.print(f"[green]✓[/green] Skill installed: {entry['target']} ({entry['platformId']})")
    for entry in result.installed_mcp:
        console.print(f"[green]✓[/green] MCP config written: {entry['target']} ({entry['platformId']})")
    for entry in result.skipped_mcp:
        console.print(f"[yellow]⊘[/yellow] MCP config skipped: {entry['platformId']} — {entry['reason']}")
    if result.installed_skills or result.installed_mcp:
        _section_title("Next steps")
        for line in [
            "1. Open (or restart) your IDE in the target repository.",
            "2. Invoke any DecisionOps MCP tool once to trigger the auth handoff.",
            "3. Complete the sign-in flow prompted by the MCP server.",
            "4. Retry the same tool call — you're live.",
        ]:
            console.print(line)


def render_cleanup_summary(result) -> None:
    _section_title("Cleanup summary")
    for entry in result.removed_skills:
        console.print(f"[red]✗[/red] Skill removed: {entry['target']} ({entry['platformId']})")
    for entry in result.skipped_skills:
        console.print(f"[dim]⊘[/dim] Skill skipped: {entry['platformId']} — {entry['reason']}")
    for entry in result.removed_mcp:
        console.print(f"[red]✗[/red] MCP config removed: {entry['target']} ({entry['platformId']})")
    for entry in result.skipped_mcp:
        console.print(f"[dim]⊘[/dim] MCP config skipped: {entry['platformId']} — {entry['reason']}")
    if result.removed_manifest_path:
        console.print(f"[red]✗[/red] Manifest removed: {result.removed_manifest_path}")
    if result.removed_mcp:
        console.print("[yellow]Restart your IDE to stop using the removed MCP server.[/yellow]")


def render_doctor_report(*, auth, auth_display: str, repo_path: str | None, manifest, platforms: Iterable[dict[str, str]], issues: list[str]) -> None:
    _section_title("DecisionOps Doctor")
    if auth:
        console.print(f"[green]✓[/green] CLI auth: configured ({auth_display})")
    else:
        console.print("[red]✗[/red] CLI auth: not configured")
        console.print("[dim]  → Run: dops login[/dim]")
    if repo_path:
        console.print(f"Repository: {repo_path}")
        if manifest:
            console.print("[green]Manifest: present[/green]")
            console.print(f"[dim]  org_id:     {manifest.get('org_id', '(missing)')}[/dim]")
            console.print(f"[dim]  project_id: {manifest.get('project_id', '(missing)')}[/dim]")
            console.print(f"[dim]  repo_ref:   {manifest.get('repo_ref', '(missing)')}[/dim]")
        else:
            console.print("[red]Manifest: missing[/red]")
            console.print("[dim]  → Run: dops init[/dim]")
    else:
        console.print("[dim]Repository: not detected (run from a git repo or pass --repo-path)[/dim]")
    table = Table(title="Platforms", box=box.SIMPLE)
    table.add_column("Platform")
    table.add_column("Skill")
    table.add_column("MCP")
    for platform in platforms:
        table.add_row(platform["displayName"], platform["skillStatus"], platform["mcpStatus"])
    console.print(table)
    if issues:
        console.print(f"[yellow]{len(issues)} issue{'s' if len(issues) != 1 else ''} found:[/yellow]")
        for issue in issues:
            console.print(f"  - {issue}")
    else:
        console.print("[green]No issues found.[/green]")


def render_auth_status(auth) -> None:
    table = Table(box=box.SIMPLE)
    table.add_column("Field")
    table.add_column("Value")
    table.add_row("Auth", "configured")
    table.add_row("API base URL", auth.apiBaseUrl)
    table.add_row("Issuer URL", auth.issuerUrl)
    table.add_row("Client ID", auth.clientId)
    table.add_row("Method", auth.method)
    table.add_row("Scopes", " ".join(auth.scopes))
    table.add_row("Access token", f"{auth.accessToken[:8]}…")
    table.add_row("Expires", auth.expiresAt or "session")
    if auth.user:
        table.add_row("User", auth.user.get("email") or auth.user.get("name") or auth.user.get("id") or "")
    console.print(table)
