#!/usr/bin/env python3
"""Remove only known generated files from this checkout."""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main(root: Path = ROOT) -> None:
    """Keep source and user data while removing the checkout's generated output."""
    for name in ["coverage", "test-results", "playwright-report", ".scannerwork"]:
        target = root / name
        if target.is_symlink():
            target.unlink()
        elif target.is_dir():
            shutil.rmtree(target)
    for artifact in root.glob("*.shell-extension.zip"):
        artifact.unlink()
    (root / "schemas/gschemas.compiled").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
