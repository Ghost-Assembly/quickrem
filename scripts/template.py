#!/usr/bin/env python3
"""Synchronize and verify the immutable Ghost Assembly tooling template."""

import argparse
import hashlib
import http.client
import io
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = "Ghost-Assembly/quick-template"


def revision(value: str) -> str:
    """Accept only an immutable Git commit identifier."""
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Template revision must be a full lowercase commit SHA")
    return value


def download(host: str, path: str) -> bytes:
    """Read a bounded response from a fixed GitHub HTTPS endpoint."""
    if host not in {"codeload.github.com", "api.github.com"}:
        raise ValueError("Unsupported template host")
    connection = http.client.HTTPSConnection(host, timeout=30)
    try:
        connection.request("GET", path, headers={"User-Agent": "quick-template"})
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError(f"Template request failed: HTTP {response.status}")
        data = response.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("Template response exceeds size limit")
        return data
    finally:
        connection.close()


def source_files(sha: str) -> dict[str, bytes]:
    """Load the canonical files; local source overrides are forbidden in CI."""
    revision(sha)
    local = os.environ.get("QUICK_TEMPLATE_SOURCE")
    if local:
        if os.environ.get("CI"):
            raise ValueError("Local template overrides are not allowed in CI")
        source = Path(local).resolve() / "template"
        return {
            p.relative_to(source).as_posix(): p.read_bytes()
            for p in source.rglob("*")
            if p.is_file()
            and not {".ruff_cache", "__pycache__", "node_modules"}.intersection(p.parts)
        }
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "quick-template"
    archive = cache / f"{sha}.zip"
    data = (
        archive.read_bytes()
        if archive.exists() and archive.stat().st_size <= 8 * 1024 * 1024
        else b""
    )
    if not zipfile.is_zipfile(io.BytesIO(data)) or os.environ.get("CI"):
        data = download("codeload.github.com", f"/{REPOSITORY}/zip/{sha}")
        if not zipfile.is_zipfile(io.BytesIO(data)):
            raise ValueError("Canonical template response is not a ZIP archive")
        cache.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                dir=cache, prefix=".download-", delete=False
            ) as stream:
                temporary = Path(stream.name)
                stream.write(data)
            temporary.replace(archive)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    prefix = f"quick-template-{sha}/template/"
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        if sum(item.file_size for item in bundle.infolist()) > 32 * 1024 * 1024:
            raise ValueError("Expanded template exceeds size limit")
        for item in bundle.infolist():
            if item.filename.startswith(prefix) and not item.is_dir():
                name = item.filename.removeprefix(prefix)
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts or str(path) != name:
                    raise ValueError("Invalid canonical template path")
                files[name] = bundle.read(item)
    if "justfile" not in files or "scripts/template.py" not in files:
        raise ValueError("Incomplete canonical template archive")
    return files


def expected_files(root: Path, files: dict[str, bytes]) -> dict[str, bytes]:
    """Render project identity into the otherwise identical npm metadata."""
    expected = dict(files)
    package = json.loads((root / "package.json").read_text())
    for name in ["package.json", "package-lock.json"]:
        document = json.loads(expected[name])
        document["name"] = package["name"]
        document["version"] = package["version"]
        if name == "package-lock.json":
            document["packages"][""]["name"] = package["name"]
            document["packages"][""]["version"] = package["version"]
        expected[name] = (json.dumps(document, indent=2) + "\n").encode()
    return expected


def compare(root: Path, expected: dict[str, bytes]) -> list[str]:
    """Report every missing or changed managed file without writing."""
    failures = []
    for name, contents in sorted(expected.items()):
        path = root / name
        if path.is_symlink() or not path.is_file() or path.read_bytes() != contents:
            failures.append(name)
    return failures


def synchronize(root: Path, sha: str, files: dict[str, bytes]) -> None:
    """Install reviewed template content and record its immutable revision."""
    for name, contents in expected_files(root, files).items():
        path = root / name
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Managed path escapes project")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)
    (root / "quick-template.lock.json").write_text(
        json.dumps(
            {
                "$schema": "quick-template.schema.json",
                "repository": REPOSITORY,
                "revision": revision(sha),
            },
            indent=2,
        )
        + "\n"
    )


def main() -> None:
    """Expose verification, explicit synchronization, and freshness checks."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "sync", "status"])
    parser.add_argument("revision", nargs="?")
    args = parser.parse_args()
    lock = json.loads((ROOT / "quick-template.lock.json").read_text())
    if lock["repository"] != REPOSITORY:
        raise ValueError("Template repository must be Ghost-Assembly/quick-template")
    sha = revision(args.revision or lock["revision"])
    if args.command == "status":
        release = json.loads(download("api.github.com", f"/repos/{REPOSITORY}/releases/latest"))
        latest = revision(release["target_commitish"])
        if latest != sha:
            raise SystemExit(
                f"Template update available: {sha} -> {latest}; run just template-sync {latest}"
            )
        print(f"PASS: latest approved template {sha}")
        return
    files = source_files(sha)
    if args.command == "sync":
        synchronize(ROOT, sha, files)
        print(f"Synced template {sha}; run npm ci --ignore-scripts and just docs-generate")
        return
    failures = compare(ROOT, expected_files(ROOT, files))
    if failures:
        raise SystemExit("Template drift:\n" + "\n".join(failures))
    digest = hashlib.sha256("\n".join(sorted(files)).encode()).hexdigest()[:12]
    print(f"PASS: {len(files)} canonical files match {sha} (inventory {digest})")


if __name__ == "__main__":
    main()
