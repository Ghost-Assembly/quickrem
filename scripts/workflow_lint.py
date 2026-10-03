#!/usr/bin/env python3
"""Lint workflows while adapting GitHub's new self references for actionlint 1.7.12.

GitHub supports $/ references as of July 2026. This actionlint release predates
that syntax. Normalize only uses values for its parser; zizmor checks originals.
No diagnostic is filtered or suppressed.
"""

import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def normalize(source: str) -> str:
    """Translate equivalent local references without changing workflow behavior."""
    return re.sub(r"(?m)^(\s*(?:-\s+)?uses:\s+)\$/", r"\1./", source)


def main() -> None:
    """Check every workflow and preserve actionlint's exit status and messages."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=ROOT)
    args = parser.parse_args()
    paths = sorted((args.directory / ".github/workflows").glob("*.y*ml"))
    if not paths:
        raise ValueError("No workflows found")
    for path in paths:
        print(f"Checking {path}", flush=True)
        subprocess.run(
            ["/usr/bin/env", "actionlint", "-"],
            input=normalize(path.read_text()),
            cwd=args.directory,
            text=True,
            check=True,
            timeout=60,
        )


if __name__ == "__main__":
    main()
