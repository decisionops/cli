from __future__ import annotations

from . import __version__


def default_user_agent() -> str:
    return f"decisionops-cli/{__version__} (+https://github.com/decisionops/cli)"
