"""Behavior regressions for canonical tooling and publication boundaries."""

import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

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
clean = load("clean")


class GitleaksTests(unittest.TestCase):
    def test_public_project_identity_cannot_exempt_credentials_or_other_contexts(self) -> None:
        public_id = "napalm255_tiler"
        fixture = hashlib.sha256(b"nonfunctional scanner regression fixture").hexdigest()[:40]
        vendor_fixture = "squ_" + fixture
        cases = [
            ("public identity", "sonar-project.properties", "sonar.projectKey", public_id, 0),
            ("other identity", "sonar-project.properties", "sonar.projectKey", fixture, 1),
            ("credential", "sonar-project.properties", "sonar.token", fixture, 1),
            ("public value as credential", "sonar-project.properties", "token", public_id, 1),
            ("other file", "other.properties", "sonar.projectKey", public_id, 1),
            (
                "vendor credential",
                "sonar-project.properties",
                "sonar.projectKey",
                vendor_fixture,
                1,
            ),
            (
                "appended credential",
                "sonar-project.properties",
                "sonar.projectKey",
                public_id + " token=" + fixture,
                1,
            ),
        ]
        for name, path, property_name, value, expected in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                (root / path).write_text(f"{property_name}={value}\n")

                result = subprocess.run(
                    [
                        "/usr/bin/env",
                        "gitleaks",
                        "dir",
                        "--redact",
                        "--no-banner",
                        "--no-color",
                        ".",
                    ],
                    cwd=root,
                    env={**os.environ, "GITLEAKS_CONFIG": str(ROOT / ".gitleaks.toml")},
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=30,
                )

                self.assertEqual(result.returncode, expected, result.stderr)


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
    def test_cli_preserves_real_actionlint_failures(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            directory = root / ".github/workflows"
            directory.mkdir(parents=True)
            with (
                patch.object(sys, "argv", ["workflow_lint.py", work]),
                patch("sys.stdout", new=io.StringIO()),
            ):
                with self.assertRaisesRegex(ValueError, "No workflows found"):
                    workflow.main()
                path = directory / "ci.yml"
                path.write_text(
                    "name: Fixture\non: workflow_dispatch\njobs:\n"
                    "  check:\n    runs-on: ubuntu-24.04\n    steps:\n"
                    "      - run: echo fixture\n"
                )
                workflow.main()
                path.write_text(path.read_text().replace("runs-on: ubuntu-24.04", "invalid: true"))
                with self.assertRaises(subprocess.CalledProcessError):
                    workflow.main()

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
    def test_sync_check_and_release_status_preserve_project_identity(self) -> None:
        sha = "a" * 40
        files = {
            "justfile": b"canonical commands",
            "scripts/template.py": b"canonical helper",
            "package.json": b'{"name":"template","version":"1.0.0"}',
            "package-lock.json": b'{"name":"template","version":"1.0.0","packages":{"":{}}}',
        }
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            identity = {"name": "quickfixture", "version": "2.0.0"}
            (root / "package.json").write_text(json.dumps(identity))
            (root / "quick-template.lock.json").write_text(
                json.dumps({"repository": template.REPOSITORY, "revision": sha})
            )
            with (
                patch.object(template, "ROOT", root),
                patch.object(template, "source_files", return_value=files),
                patch("sys.stdout", new=io.StringIO()),
            ):
                with patch.object(sys, "argv", ["template.py", "sync", sha]):
                    template.main()
                self.assertEqual(json.loads((root / "package.json").read_text()), identity)
                lock = json.loads((root / "package-lock.json").read_text())
                self.assertEqual(lock["packages"][""], identity)
                self.assertEqual(template.compare(root, template.expected_files(root, files)), [])
                with patch.object(sys, "argv", ["template.py", "check"]):
                    template.main()
                    (root / "justfile").write_text("local drift")
                    with self.assertRaisesRegex(SystemExit, "Template drift"):
                        template.main()
                with (
                    patch.object(sys, "argv", ["template.py", "status"]),
                    patch.object(
                        template,
                        "download",
                        return_value=json.dumps({"target_commitish": sha}).encode(),
                    ),
                ):
                    template.main()
                with (
                    patch.object(sys, "argv", ["template.py", "status"]),
                    patch.object(
                        template,
                        "download",
                        return_value=json.dumps({"target_commitish": "b" * 40}).encode(),
                    ),
                    self.assertRaisesRegex(SystemExit, "Template update available"),
                ):
                    template.main()

    def test_sync_cannot_write_through_a_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / "repo"
            root.mkdir()
            (root / "package.json").write_text('{"name":"quickfixture","version":"1.0.0"}')
            outside = Path(work) / "outside"
            outside.write_text("private fixture")
            (root / "alias").symlink_to(outside)
            files = {
                "alias": b"replacement",
                "package.json": b'{"name":"template","version":"1.0.0"}',
                "package-lock.json": b'{"name":"template","version":"1.0.0","packages":{"":{}}}',
            }
            with self.assertRaises(ValueError):
                template.synchronize(root, "a" * 40, files)
            self.assertEqual(outside.read_text(), "private fixture")

    def test_local_source_override_is_rejected_in_ci(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            payload = Path(work) / "template"
            payload.mkdir()
            (payload / "justfile").write_text("local commands")
            (payload / "__pycache__").mkdir()
            (payload / "__pycache__/cache.pyc").write_bytes(b"generated")
            with patch.dict(os.environ, {"QUICK_TEMPLATE_SOURCE": work, "CI": ""}):
                self.assertEqual(template.source_files("a" * 40), {"justfile": b"local commands"})
                with patch.dict(os.environ, {"CI": "true"}), self.assertRaises(ValueError):
                    template.source_files("a" * 40)

    def test_archive_rejects_paths_that_escape_the_payload_and_incomplete_content(self) -> None:
        sha = "a" * 40
        for names in [["../outside"], ["justfile"]]:
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                for name in names:
                    archive.writestr(f"quick-template-{sha}/template/{name}", b"fixture")
            with (
                self.subTest(names=names),
                tempfile.TemporaryDirectory() as work,
                patch.dict(
                    os.environ, {"XDG_CACHE_HOME": work, "QUICK_TEMPLATE_SOURCE": "", "CI": "true"}
                ),
                patch.object(template, "download", return_value=data.getvalue()),
                self.assertRaises(ValueError),
            ):
                template.source_files(sha)

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

    def test_pull_request_results_must_match_the_review_and_revision(self) -> None:
        reviews = [{"key": "3", "base": "main", "commit": {"sha": "current"}}]
        revision = gate.pull_request_revision(reviews, "3")
        self.assertIsNone(gate.validate(self.measures(), revision, "current"))
        with self.assertRaises(ValueError):
            gate.validate(self.measures(), revision, "stale")
        with self.assertRaises(ValueError):
            gate.pull_request_revision(reviews, "4")
        with self.assertRaises(ValueError):
            gate.pull_request_revision([{"key": "3", "base": "other"}], "3")

    def test_cli_checks_the_requested_scope_and_rejects_dismissed_findings(self) -> None:
        def responder(selection: dict[str, str], responses: dict):
            def respond(endpoint: str, parameters: dict[str, str]) -> dict:
                if endpoint in {"measures/component", "issues/search"}:
                    self.assertEqual(
                        {k: v for k, v in parameters.items() if k in {"pullRequest", "branch"}},
                        selection,
                    )
                return responses[endpoint]

            return respond

        for review in [False, True]:
            for dismissed in [0, 1]:
                selection = {"pullRequest": "3"} if review else {"branch": "main"}
                responses = {
                    "project_pull_requests/list": {
                        "pullRequests": [{"key": "3", "base": "main", "commit": {"sha": "current"}}]
                    },
                    "project_branches/list": {"branches": [{"name": "main", "type": "LONG"}]},
                    "project_analyses/search": {"analyses": [{"revision": "current"}]},
                    "measures/component": {"component": {"measures": self.measures()}},
                    "issues/search": {"total": dismissed},
                }

                argv = ["sonar_gate.py", "--project", "fixture", "--revision", "current"]
                if review:
                    argv.extend(["--pull-request", "3"])
                with (
                    self.subTest(review=review, dismissed=dismissed),
                    patch.object(gate, "request", side_effect=responder(selection, responses)),
                    patch.object(sys, "argv", argv),
                    patch("sys.stdout", new=io.StringIO()),
                ):
                    if dismissed:
                        with self.assertRaises(ValueError):
                            gate.main()
                    else:
                        gate.main()

    def test_short_branch_results_cannot_approve_overall_code(self) -> None:
        branches = [
            {"name": "main", "type": "LONG"},
            {"name": "branch-review-1", "type": "LONG"},
            {"name": "review-1", "type": "SHORT"},
        ]
        for name in ["main", "branch-review-1"]:
            with self.subTest(branch=name):
                self.assertIsNone(gate.validate_branch(branches, name))
        for name in ["review-1", "missing"]:
            with self.subTest(branch=name), self.assertRaises(ValueError):
                gate.validate_branch(branches, name)

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


class TransportTests(unittest.TestCase):
    def test_https_clients_fail_closed_and_close_connections(self) -> None:
        def fetch(client):
            if client is gate:
                return gate.request("fixture", {"project": "fixture with space"})
            return template.download("codeload.github.com", "/fixture")

        credential = hashlib.sha256(b"nonfunctional HTTP credential fixture").hexdigest()
        for module, limit in [(gate, 4 * 1024 * 1024), (template, 8 * 1024 * 1024)]:
            for status, data, error in [
                (200, b'{"fixture":true}', None),
                (403, b"denied", RuntimeError),
                (200, b"x" * (limit + 1), ValueError),
            ]:
                connection = Mock()
                response = connection.getresponse.return_value
                response.status = status
                response.read.return_value = data
                with (
                    self.subTest(
                        client=module.__name__, status=status, oversized=len(data) > limit
                    ),
                    patch.dict(os.environ, {"SONAR_TOKEN": credential}),
                    patch.object(module.http.client, "HTTPSConnection", return_value=connection),
                ):
                    if error:
                        with self.assertRaises(error):
                            fetch(module)
                    elif module is gate:
                        self.assertEqual(fetch(module), {"fixture": True})
                        path = connection.request.call_args.args[1]
                        self.assertIn("project=fixture+with+space", path)
                        self.assertNotIn(credential, path)
                    else:
                        self.assertEqual(fetch(module), data)
                    connection.close.assert_called_once()
        with patch.dict(os.environ, {"SONAR_TOKEN": ""}), self.assertRaises(ValueError):
            gate.request("fixture", {})
        with self.assertRaises(ValueError):
            template.download("untrusted.example.test", "/fixture")


class PackagingTests(unittest.TestCase):
    def test_packages_are_deterministic_and_detect_content_or_inventory_drift(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            files = {
                "metadata.json": json.dumps({"uuid": "fixture@example.test"}).encode(),
                "extension.js": b"runtime extension",
                "prefs.js": b"runtime preferences",
                "LICENSE": b"fixture license",
                "modules/model.js": b"runtime model",
            }
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            (root / ".env").write_text("private fixture")
            (root / "quick-project.json").write_text(json.dumps({"runtimeFiles": list(files)}))

            def pack(command: list[str], **kwargs) -> None:
                if command[0] == "/usr/bin/gnome-extensions":
                    destination = kwargs["cwd"] / "packed" / bundle.artifact_name(root)
                    with zipfile.ZipFile(destination, "w") as archive:
                        for name, content in files.items():
                            archive.writestr(name, content)

            with patch.object(bundle.subprocess, "run", side_effect=pack):
                artifact = bundle.build(root)
                first = artifact.read_bytes()
                self.assertEqual(bundle.build(root).read_bytes(), first)
                with zipfile.ZipFile(artifact) as archive:
                    self.assertEqual(set(archive.namelist()), set(files))
                    self.assertEqual(archive.read("modules/model.js"), files["modules/model.js"])
                with patch("sys.stdout", new=io.StringIO()):
                    bundle.check(root)
                for name in ["modules/model.js", "unexpected.js"]:
                    with zipfile.ZipFile(artifact, "w") as archive:
                        for path, content in files.items():
                            archive.writestr(path, b"changed" if path == name else content)
                        if name not in files:
                            archive.writestr(name, b"unexpected")
                    with self.subTest(name=name), self.assertRaises(ValueError):
                        bundle.check(root)

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
    def test_generation_preserves_project_content_and_detects_stale_docs(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            (root / "docs").mkdir()
            modules = ROOT / "node_modules"
            if not modules.exists():
                modules = ROOT.parent / "node_modules"
            (root / "node_modules").symlink_to(modules, target_is_directory=True)
            metadata = {"uuid": "fixture@example.test", "shell-version": ["49", "50"]}
            project = {"repository": "quickspot", "requirements": "Fixture <dependency>."}
            (root / "metadata.json").write_text(json.dumps(metadata))
            (root / "docs/project.json").write_text(json.dumps(project))
            regions = "\n".join(
                f"<!-- quick-template:{name}:start --><!-- quick-template:{name}:end -->"
                for name in [*docs.SECTIONS, "badges"]
            )
            (root / "README.md").write_text("# Project prose\n" + regions)
            (root / "docs/index.html").write_text(
                "<!doctype html><main>Project prose\n" + regions + "</main>"
            )
            with patch.object(docs, "ROOT", root), patch("sys.stdout", new=io.StringIO()):
                with patch.object(sys, "argv", ["docs.py"]):
                    docs.main()
                readme = (root / "README.md").read_text()
                page = (root / "docs/index.html").read_text()
                self.assertIn("# Project prose", readme)
                self.assertIn("Fixture &lt;dependency&gt;.", page)
                self.assertIn("<!--email_off-->fixture@example.test<!--/email_off-->", page)
                self.assertIn("systemctl --user disable --now quickspot-soloist.service", readme)
                self.assertIn("Security issues", readme)
                with patch.object(sys, "argv", ["docs.py", "--check"]):
                    docs.main()
                    (root / "README.md").write_text(
                        readme.replace("just test-docs", "stale command")
                    )
                    with self.assertRaisesRegex(SystemExit, "Stale generated docs"):
                        docs.main()

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


class CleanupTests(unittest.TestCase):
    def test_cleanup_preserves_source_and_external_symlink_targets(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work) / "repo"
            root.mkdir()
            outside = Path(work) / "outside"
            outside.mkdir()
            (outside / "private.txt").write_text("private fixture")
            (root / "coverage").symlink_to(outside, target_is_directory=True)
            (root / "test-results").mkdir()
            (root / "test-results/output.json").write_text("generated")
            (root / "schemas").mkdir()
            (root / "schemas/gschemas.compiled").write_bytes(b"generated")
            (root / "fixture.shell-extension.zip").write_bytes(b"generated")
            (root / "source.js").write_text("source")
            clean.main(root)
            clean.main(root)
            self.assertEqual((outside / "private.txt").read_text(), "private fixture")
            self.assertEqual((root / "source.js").read_text(), "source")
            self.assertFalse((root / "coverage").is_symlink())
            self.assertFalse((root / "test-results").exists())
            self.assertFalse((root / "schemas/gschemas.compiled").exists())
            self.assertEqual(list(root.glob("*.shell-extension.zip")), [])


if __name__ == "__main__":
    unittest.main()
