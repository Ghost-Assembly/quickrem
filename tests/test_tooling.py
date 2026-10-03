"""Behavior regressions for canonical tooling and publication boundaries."""

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name: str):
    """Load the repository helper rather than a separate implementation."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load shared helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


template = load("template")
gate = load("sonar_gate")
bundle = load("build")
docs = load("docs")
workflow = load("workflow_lint")
security = load("security_source")


class SecuritySourceTests(unittest.TestCase):
    def test_scan_includes_untracked_source_but_not_private_ignored_files(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / "repo"
            destination = Path(work) / "scan"
            root.mkdir()
            destination.mkdir()
            subprocess.run(
                ["/usr/bin/env", "git", "init", "--quiet"], cwd=root, check=True, timeout=10
            )
            (root / ".gitignore").write_text(".env\ncoverage/\n")
            (root / ".env").write_text("private fixture")
            (root / "new.py").write_text("new source")
            security.export(root, destination)
            self.assertEqual((destination / "new.py").read_text(), "new source")
            self.assertFalse((destination / ".env").exists())

    def test_source_symlink_cannot_read_outside_the_repository(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / "repo"
            destination = Path(work) / "scan"
            root.mkdir()
            destination.mkdir()
            subprocess.run(
                ["/usr/bin/env", "git", "init", "--quiet"], cwd=root, check=True, timeout=10
            )
            private = Path(work) / "private"
            private.write_text("private fixture")
            (root / "alias.py").symlink_to(private)
            with self.assertRaises(ValueError):
                security.export(root, destination)


class WorkflowTests(unittest.TestCase):
    def test_only_self_repository_uses_are_adapted(self) -> None:
        source = "    uses: $/.github/workflows/ci.yml\n    run: echo '$/unchanged'\n"
        self.assertEqual(
            workflow.normalize(source),
            "    uses: ./.github/workflows/ci.yml\n    run: echo '$/unchanged'\n",
        )

    def test_invalid_workflow_content_is_preserved_for_the_linter(self) -> None:
        source = "jobs:\n    run: invalid\n    uses: remote/repo@main\n"
        self.assertEqual(workflow.normalize(source), source)


class TemplateTests(unittest.TestCase):
    def test_corrupt_archive_cache_is_recovered_and_reused(self) -> None:
        sha = "a" * 40
        buffer = io.BytesIO()
        expected = {"justfile": b"canonical commands", "scripts/template.py": b"canonical helper"}
        with zipfile.ZipFile(buffer, "w") as bundle:
            for name, data in expected.items():
                bundle.writestr(f"quick-template-{sha}/template/{name}", data)
        with tempfile.TemporaryDirectory() as work:
            cache = Path(work) / "quick-template"
            cache.mkdir()
            archive = cache / f"{sha}.zip"
            archive.write_bytes(b"interrupted download")
            with (
                patch.dict(
                    os.environ, {"XDG_CACHE_HOME": work, "QUICK_TEMPLATE_SOURCE": "", "CI": ""}
                ),
                patch.object(template, "download", return_value=buffer.getvalue()) as download,
            ):
                self.assertEqual(template.source_files(sha), expected)
                self.assertEqual(template.source_files(sha), expected)
                download.assert_called_once()
            self.assertTrue(zipfile.is_zipfile(archive))
            self.assertEqual(list(cache.glob(".download-*")), [])

    def test_local_manifest_cannot_bless_changed_canonical_content(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "mise.toml").write_text("node = 'latest'")
            (root / "template.sha256").write_text("locally approved checksum")
            self.assertEqual(
                template.compare(root, {"mise.toml": b"node = '24.21.0'"}), ["mise.toml"]
            )

    def test_missing_files_and_symlinks_fail(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "alias").symlink_to(root / "missing")
            self.assertEqual(
                template.compare(root, {"alias": b"x", "missing": b"y"}), ["alias", "missing"]
            )

    def test_template_revision_must_be_immutable(self) -> None:
        for value in ["main", "v1.0.0", "a" * 39, "a" * 41, "../main"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                template.revision(value)


class SonarTests(unittest.TestCase):
    def measures(self) -> list[dict]:
        return [{"metric": name, "value": "0"} for name in gate.METRICS]

    def test_current_zero_results_pass(self) -> None:
        self.assertIsNone(gate.validate(self.measures(), "current", "current"))

    def test_every_quality_category_and_exact_duplication_are_required(self) -> None:
        for name in gate.METRICS:
            measures = self.measures()
            next(item for item in measures if item["metric"] == name)["value"] = "1"
            with self.subTest(metric=name), self.assertRaises(ValueError):
                gate.validate(measures, "current", "current")

    def test_missing_metrics_and_stale_analysis_fail(self) -> None:
        with self.assertRaises(ValueError):
            gate.validate(self.measures()[1:], "current", "current")
        with self.assertRaises(ValueError):
            gate.validate(self.measures(), "previous", "current")


class PackagingTests(unittest.TestCase):
    def test_unsafe_runtime_paths_are_rejected_before_packaging(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            for name in ["../secret", "/etc/passwd", "scripts/../../secret", ".env"]:
                (root / "quick-project.json").write_text(json.dumps({"runtimeFiles": [name]}))
                with self.subTest(name=name), self.assertRaises(ValueError):
                    bundle.runtime_files(root)

    def test_invalid_uuid_cannot_choose_an_output_path(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "metadata.json").write_text(json.dumps({"uuid": "../../secret"}))
            with self.assertRaises(ValueError):
                bundle.artifact_name(root)


class DocumentationTests(unittest.TestCase):
    def test_install_restart_precedes_enable(self) -> None:
        sections = docs.blocks(
            {"uuid": "fixture@example.test", "shell-version": ["50"]},
            {"repository": "fixture", "requirements": "Fixture dependency."},
        )
        content = docs.markdown(sections["install"])
        self.assertLess(
            content.index("Log out and back in"), content.index("gnome-extensions enable")
        )
        self.assertIn("Fixture dependency.", content)

    def test_html_escapes_project_content(self) -> None:
        self.assertEqual(
            docs.markup([("p", "<script>unsafe</script>")]),
            "<p>&lt;script&gt;unsafe&lt;/script&gt;</p>",
        )

    def test_missing_or_duplicate_generation_markers_fail(self) -> None:
        with self.assertRaises(ValueError):
            docs.replace_block("handwritten", "install", "generated")
        region = "<!-- quick-template:install:start --><!-- quick-template:install:end -->"
        with self.assertRaises(ValueError):
            docs.replace_block(region * 2, "install", "generated")


if __name__ == "__main__":
    unittest.main()
