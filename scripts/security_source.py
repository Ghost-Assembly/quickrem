#!/usr/bin/env python3
"""Scan publishable Git source, including untracked edits, without private .env files.

Git's own ignore rules define what can enter source control. Dependencies are
checked through the lockfile; generated output is not copied into this scan.
Full Git history is checked separately, without this source selection.
"""

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def export(root: Path, destination: Path) -> None:
    """Copy tracked and untracked source while respecting Git's ignore rules."""
    result = subprocess.run(
        ["/usr/bin/env", "git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
        timeout=30,
    )
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        name = Path(entry.decode())
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("Git source path must remain inside the repository")
        source = root / name
        if not source.exists():
            continue
        if not source.resolve().is_relative_to(root.resolve()):
            raise ValueError("Git source symlink escapes the repository")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def main() -> None:
    """Run the same source scanners locally and in GitHub Actions."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=ROOT)
    root = parser.parse_args().directory.resolve()
    with tempfile.TemporaryDirectory(prefix="quick-security-") as work:
        staging = Path(work)
        export(root, staging)
        subprocess.run(
            ["/usr/bin/env", "gitleaks", "dir", "--redact", "--no-banner", "."],
            cwd=staging,
            check=True,
            timeout=120,
        )
        subprocess.run(
            [
                "/usr/bin/env",
                "trivy",
                "fs",
                "--scanners",
                "vuln,secret,misconfig",
                "--exit-code",
                "1",
                ".",
            ],
            cwd=staging,
            check=True,
            timeout=300,
        )


if __name__ == "__main__":
    main()
