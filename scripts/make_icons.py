#!/usr/bin/env python3
"""Regenerate platform icons from the master 1024 PNG.

    npx tauri icon src-tauri/app-icon-source.png
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    source = root / "src-tauri" / "app-icon-source.png"
    if not source.is_file():
        raise SystemExit(f"missing source icon: {source}")
    subprocess.check_call(["npx", "tauri", "icon", str(source)], cwd=root)


if __name__ == "__main__":
    sys.exit(main())
