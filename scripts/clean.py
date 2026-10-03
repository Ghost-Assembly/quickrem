#!/usr/bin/env python3
"""Remove only known generated files from this checkout."""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for name in ["coverage", "test-results", "playwright-report", ".scannerwork"]:
    target = ROOT / name
    if target.is_symlink():
        target.unlink()
    elif target.is_dir():
        shutil.rmtree(target)
for artifact in ROOT.glob("*.shell-extension.zip"):
    artifact.unlink()
(ROOT / "schemas/gschemas.compiled").unlink(missing_ok=True)
