from __future__ import annotations

import argparse

from . import __version__
from .argparse_utils import DopsHelpFormatter, add_examples
from .command_groups import register_all_commands
from .ui import CancelledError, error_console


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dops",
        formatter_class=DopsHelpFormatter,
        description="dops — repo-anchored CLI for working with decisions\n\nRespects NO_COLOR and FORCE_COLOR environment variables.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command")
    add_examples(
        parser,
        [
            "dops login",
            "dops init --org-id acme --project-id backend --repo-ref acme/backend",
            "dops install --platform codex",
            "dops update",
            "dops doctor",
        ],
    )
    register_all_commands(subparsers)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        parser.print_help()
        return 0
    try:
        result = args.func(args)
        return int(result) if isinstance(result, int) else 0
    except CancelledError:
        print("\nCancelled.")
        return 0
    except Exception as error:
        error_console.print(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
