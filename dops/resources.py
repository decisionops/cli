from __future__ import annotations

import os
from pathlib import Path


def _directory_has_toml_files(dir_path: Path) -> bool:
    try:
        return dir_path.is_dir() and any(entry.suffix == ".toml" for entry in dir_path.iterdir())
    except OSError:
        return False


def _is_skill_bundle_dir(dir_path: Path) -> bool:
    try:
        return dir_path.is_dir() and (dir_path / "SKILL.md").exists()
    except OSError:
        return False


def _ancestor_dirs(start: str) -> list[Path]:
    dirs: list[Path] = []
    current = Path(start).resolve()
    while True:
        dirs.append(current)
        if current.parent == current:
            break
        current = current.parent
    return dirs


def _search_roots(overrides: list[str] | None = None) -> list[Path]:
    if overrides:
        return [Path(item).resolve() for item in overrides]
    defaults = [
        Path(__file__).resolve().parent,
        Path.cwd(),
        Path(os.path.dirname(os.path.realpath(os.sys.executable))),
    ]
    unique: list[Path] = []
    for item in defaults:
        if item not in unique:
            unique.append(item)
    return unique


def _find_resource_dir(
    candidates: list[tuple[str, ...]],
    matcher,
    error_message: str,
    roots: list[str] | None = None,
) -> str:
    for root in _search_roots(roots):
        for base in _ancestor_dirs(str(root)):
            for segments in candidates:
                candidate = base.joinpath(*segments)
                if matcher(candidate):
                    return str(candidate)
    raise RuntimeError(error_message)


def find_platforms_dir(roots: list[str] | None = None) -> str:
    return _find_resource_dir(
        [
            ("node_modules", "@decisionops", "skill", "platforms"),
            ("skill", "platforms"),
            ("platforms",),
        ],
        _directory_has_toml_files,
        "Could not find platform definitions. Ensure @decisionops/skill is installed or is adjacent.",
        roots,
    )


def find_skill_source_dir(roots: list[str] | None = None) -> str:
    return _find_resource_dir(
        [
            ("node_modules", "@decisionops", "skill", "decision-ops"),
            ("skill", "decision-ops"),
            ("decision-ops",),
        ],
        _is_skill_bundle_dir,
        "Could not find DecisionOps skill bundle. Pass --source-dir or install @decisionops/skill.",
        roots,
    )
