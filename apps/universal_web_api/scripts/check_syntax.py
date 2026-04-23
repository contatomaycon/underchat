#!/usr/bin/env python3
"""Basic syntax validation for Python sources in this workspace."""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def iter_python_files() -> list[Path]:
    files = [ROOT / "main.py", ROOT / "check_deps.py", ROOT / "clean_profile.py", ROOT / "patch_drissionpage.py", ROOT / "update_preserve.py", ROOT / "updater.py"]
    files.extend(sorted((ROOT / "app").rglob("*.py")))
    return [f for f in files if f.exists()]


def main() -> None:
    files = iter_python_files()
    if not files:
        raise SystemExit("No Python files found.")

    for path in files:
        source = path.read_text(encoding="utf-8-sig")
        ast.parse(source, filename=str(path))

    print(f"Syntax check passed for {len(files)} files.")


if __name__ == "__main__":
    main()
