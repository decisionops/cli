from __future__ import annotations

import argparse


class DopsHelpFormatter(argparse.RawDescriptionHelpFormatter):
    pass


def add_examples(parser: argparse.ArgumentParser, examples: list[str]) -> None:
    section = "Examples:\n" + "\n".join(f"  {example}" for example in examples)
    parser.epilog = f"{parser.epilog}\n\n{section}" if parser.epilog else section


def add_notes(parser: argparse.ArgumentParser, notes: list[str]) -> None:
    section = "Notes:\n" + "\n".join(f"  {note}" for note in notes)
    parser.epilog = f"{parser.epilog}\n\n{section}" if parser.epilog else section
