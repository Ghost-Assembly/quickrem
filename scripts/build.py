#!/usr/bin/env python3
"""Package only explicitly declared runtime files and verify the official ZIP."""

import argparse
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent


def runtime_files(root: Path) -> list[str]:
    """Validate the runtime manifest before reading or copying any file."""
    names = json.loads((root / "quick-project.json").read_text())["runtimeFiles"]
    if (
        not isinstance(names, list)
        or not names
        or not all(isinstance(name, str) for name in names)
        or len(names) != len(set(names))
    ):
        raise ValueError("Runtime files must be a nonempty list of unique paths")
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or str(path) != name:
            raise ValueError("Runtime path must be a normalized relative path")
        source = root / name
        if source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):
            raise ValueError("Runtime files must remain inside the project")
        if not source.is_file() or (
            source.suffix not in {".js", ".py", ".json", ".xml", ".svg", ".css"}
            and name != "LICENSE"
        ):
            raise ValueError("Runtime manifest contains a missing or unsupported file")
    if not {"metadata.json", "extension.js", "prefs.js", "LICENSE"}.issubset(names):
        raise ValueError("Runtime manifest is missing required extension files")
    return names


def artifact_name(root: Path) -> str:
    """Read a safe extension identity from GNOME metadata."""
    uuid = json.loads((root / "metadata.json").read_text())["uuid"]
    if (
        not isinstance(uuid, str)
        or not uuid
        or any(
            c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._@-"
            for c in uuid
        )
    ):
        raise ValueError("Invalid extension UUID")
    return f"{uuid}.shell-extension.zip"


def stage(root: Path, destination: Path) -> list[str]:
    """Copy the declared source without dependencies, credentials, or output."""
    names = runtime_files(root)
    for name in names:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, target)
    subprocess.run(
        ["/usr/bin/glib-compile-schemas", "--strict", "--dry-run", "schemas"],
        cwd=destination,
        check=True,
        timeout=30,
    )
    return names


def build(root: Path = ROOT) -> Path:
    """Build atomically with a stable archive layout and timestamps."""
    artifact = root / artifact_name(root)
    with tempfile.TemporaryDirectory(prefix="quick-build-", dir=root) as work:
        staging = Path(work)
        names = stage(root, staging)
        staged_zip = staging / artifact.name
        with zipfile.ZipFile(staged_zip, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name in sorted(names):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                bundle.writestr(info, (staging / name).read_bytes())
        staged_zip.replace(artifact)
    return artifact


def check(root: Path = ROOT) -> None:
    """Compare file contents, not only filenames, with GNOME's packer."""
    artifact = root / artifact_name(root)
    with tempfile.TemporaryDirectory(prefix="quick-pack-") as work:
        staging = Path(work)
        names = stage(root, staging)
        # All optional directories exist, so every extension uses one invocation.
        for directory in ["modules", "icons", "scripts", "packed"]:
            (staging / directory).mkdir(exist_ok=True)
        subprocess.run(
            [
                "/usr/bin/gnome-extensions",
                "pack",
                "--force",
                "--out-dir=packed",
                "--extra-source=modules",
                "--extra-source=icons",
                "--extra-source=scripts",
                "--extra-source=LICENSE",
                ".",
            ],
            cwd=staging,
            check=True,
            timeout=30,
        )
        with (
            zipfile.ZipFile(artifact) as actual,
            zipfile.ZipFile(staging / "packed" / artifact.name) as official,
        ):
            actual_files = {n for n in actual.namelist() if not n.endswith("/")}
            official_files = {n for n in official.namelist() if not n.endswith("/")}
            if (
                actual_files != set(names)
                or actual_files != official_files
                or any(actual.read(n) != official.read(n) for n in names)
            ):
                raise ValueError("Bundle differs from GNOME's official packer")
    print("PASS: runtime files and contents match GNOME's official packer")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        print(f"Built {build().name}")
