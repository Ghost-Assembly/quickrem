#!/usr/bin/env python3
"""Render shared instructions and README badges without a website runtime."""

import argparse
import html
import json
import subprocess
from pathlib import Path
from urllib.parse import quote, urlencode

ROOT = Path(__file__).resolve().parent.parent
SECTIONS = ["install", "uninstall", "testing", "packaging", "releasing", "development"]
COMMANDS = """just setup        # install pinned tools, dependencies, and browsers
just fmt          # format source and configuration
just lint         # verify template, generated docs, source, and schemas
just test         # JavaScript, Python, and project offline tests
just coverage     # report JavaScript and Python coverage without source exclusions
just test-docs    # Chromium and Firefox documentation checks
just security     # dependencies, secrets, and workflow checks
just build        # build the runtime-only extension ZIP
just pack-check   # compare files and contents with GNOME's packer
just ci           # complete local verification and packaging
just test-live    # isolated GNOME lifecycle and project integration checks
just docs         # serve the static site at localhost:8000
just template-check  # verify the pinned canonical template
just template-status # report a newer approved template revision"""


def blocks(metadata: dict, project: dict) -> dict[str, list[tuple[str, str]]]:
    """Keep shared prose in one place and identity in metadata."""
    uuid = metadata["uuid"]
    name = project["repository"]
    install = (
        f"xh --download GET https://github.com/Ghost-Assembly/{name}/releases/latest/download/{uuid}.shell-extension.zip\n"
        f"gnome-extensions install --force {uuid}.shell-extension.zip"
    )
    uninstall = f"gnome-extensions disable {uuid}\ngnome-extensions uninstall {uuid}"
    if name == "quickspot":
        uninstall = (
            "if systemctl --user cat quickspot-soloist.service >/dev/null 2>&1; then\n"
            "    systemctl --user disable --now quickspot-soloist.service\nfi\n" + uninstall
        )
    return {
        "install": [
            (
                "p",
                "Requires GNOME Shell "
                + " or ".join(metadata["shell-version"])
                + ". "
                + project["requirements"],
            ),
            ("h3", "From a release"),
            (
                "p",
                (
                    "Download the latest release ZIP and install it for your user. xh is a "
                    "download tool; you can also download the ZIP from GitHub in a browser. "
                    "Installing compiles the settings schema."
                ),
            ),
            ("code", install),
            ("p", "Log out and back in so GNOME discovers the extension, then enable it:"),
            ("code", f"gnome-extensions enable {uuid}"),
            ("h3", "From a clone"),
            (
                "p",
                (
                    "Install mise and activate it in your shell. Clone the repository, "
                    "install its pinned tools, and build and install the same ZIP used for "
                    "releases:"
                ),
            ),
            (
                "code",
                f"git clone https://github.com/Ghost-Assembly/{name}.git\ncd {name}\n"
                "mise install\nmise exec -- just setup\nmise exec -- just install",
            ),
            (
                "p",
                (
                    "Log out and back in, then run just enable. Run just prefs to open "
                    "preferences. After updating a loaded extension, start a new session to "
                    "load its new code; opening preferences does not reload GNOME Shell."
                ),
            ),
        ],
        "uninstall": [
            (
                "p",
                (
                    "Disable and uninstall the extension for your user. These commands "
                    "preserve saved settings and other user data."
                ),
            ),
            ("code", uninstall),
            (
                "p",
                (
                    "From a clone, just uninstall performs the same steps. Disabling with "
                    "just disable leaves the extension installed."
                ),
            ),
        ],
        "testing": [
            (
                "p",
                (
                    "just test runs the JavaScript suite with Vitest, the shared tooling "
                    "tests, and any project-specific offline suites. just coverage reports "
                    "runtime JavaScript and Python tooling coverage, including untested files. Test"
                    " stubs and generated reports are not runtime source."
                ),
            ),
            (
                "p",
                (
                    "just test-docs runs Playwright and axe in Chromium and Firefox: dark and"
                    " light accessibility checks, keyboard navigation, mobile layout, reduced"
                    " motion, links, metadata, local assets, and no page JavaScript. "
                    "Automated accessibility checks still require human review of reading and"
                    " focus order."
                ),
            ),
            (
                "p",
                (
                    "just test-live checks the package and runs isolated GNOME lifecycle "
                    "checks. It is a separate local check, not proof of compatibility from a "
                    "hosted runner. Verify each declared GNOME version and complete the "
                    "project's manual checks before releasing."
                ),
            ),
        ],
        "packaging": [
            ("code", "just build\njust pack-check"),
            (
                "p",
                f"The output is {uuid}.shell-extension.zip at the repository root, with "
                "metadata.json at the archive root. Python's standard library packages "
                "the explicit runtimeFiles allowlist in quick-project.json, using stable "
                "file order and timestamps.",
            ),
            (
                "p",
                (
                    "just pack-check compares both filenames and file contents with GNOME's "
                    "official packer and validates shipped icons. Docs, tests, dependencies, "
                    "credentials, downloaded binaries, and development artifacts stay outside"
                    " the ZIP. Update the runtime allowlist when adding a runtime file."
                ),
            ),
        ],
        "releasing": [
            (
                "p",
                (
                    "Run just ci, just test-live, and the project manual checklist. Set "
                    "metadata.json version-name and package.json version to the same new "
                    "version. The GNOME Extensions website assigns the numeric metadata.json "
                    "version during submission. Update the npm lockfile, regenerate the docs, "
                    "and commit the "
                    "reviewed changes to main through a passing pull request."
                ),
            ),
            (
                "p",
                (
                    "Create and push a v-prefixed tag for that version. The release workflow "
                    "verifies the version, main ancestry, and successful required checks for"
                    " the tagged commit, then attaches its tested ZIP to a GitHub release. It does"
                    " not upload to extensions.gnome.org; that submission and its review "
                    "remain manual."
                ),
            ),
        ],
        "development": [
            (
                "p",
                (
                    "mise.toml pins runtime and CLI versions; justfile owns commands; npm "
                    "owns development dependencies and the lockfile. GNOME libraries come "
                    "from the host. On image-based Fedora, use the host's available tools or "
                    "a toolbox/distrobox for missing system packages; do not layer packages "
                    "onto the OS."
                ),
            ),
            ("code", COMMANDS),
            (
                "p",
                (
                    "GitHub requires local verification, security analysis, and completed "
                    "Sonar analysis. The shared Sonar policy requires zero security, "
                    "reliability, and maintainability issues and zero duplicated lines. "
                    "PR checks cover changed code; main checks cover the entire project. "
                    "Missing configuration fails instead of silently skipping analysis. Pages"
                    " publishes the tested docs only after the required checks pass on main."
                ),
            ),
            (
                "p",
                (
                    "Common tooling and these instructions are generated from a pinned "
                    "canonical template. Change that source and synchronize its approved "
                    "revision; do not edit generated sections or locally bless drift. "
                    "Extension-specific behavior belongs in project configuration and "
                    "project.just."
                ),
            ),
        ],
    }


def markdown(items: list[tuple[str, str]]) -> str:
    """Render the same semantic content for GitHub."""
    return "\n\n".join(
        "```sh\n" + text + "\n```" if kind == "code" else "### " + text if kind == "h3" else text
        for kind, text in items
    )


def markup(items: list[tuple[str, str]]) -> str:
    """Escape all generated prose and commands before writing HTML."""
    parts = []
    for kind, text in items:
        escaped = html.escape(text)
        if kind == "code":
            parts.append(
                '<div class="code night"><div class="code-label">Shell</div><pre><code>'
                + escaped
                + "</code></pre></div>"
            )
        else:
            parts.append(f"<{kind}>{escaped}</{kind}>")
    return "\n".join(parts)


def replace_block(text: str, name: str, content: str) -> str:
    """Replace an explicitly marked generated region; never infer ownership."""
    start = f"<!-- quick-template:{name}:start -->"
    end = f"<!-- quick-template:{name}:end -->"
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError(f"Expected exactly one generated region: {name}")
    before, rest = text.split(start)
    _, after = rest.split(end)
    return before + start + "\n" + content + "\n" + end + after


def badges(repo: str, metadata: dict) -> str:
    """Link live project status without publishing credential-bearing URLs."""
    github = "https://github.com/Ghost-Assembly/" + repo
    sonar = "https://sonarcloud.io/dashboard?id=Ghost-Assembly_" + repo
    items = []
    for label, workflow in [("CI", "ci.yml"), ("Security", "security.yml")]:
        items.append(
            f"[![{label}]({github}/actions/workflows/{workflow}/badge.svg?branch=main)]({github}/actions/workflows/{workflow})"
        )
    for label, image, link in [
        (
            "Docs",
            "https://img.shields.io/website?"
            + urlencode({"url": "https://ghost-assembly.com/" + repo + "/", "label": "docs"}),
            "https://ghost-assembly.com/" + repo + "/",
        ),
        (
            "Release",
            f"https://img.shields.io/github/v/release/Ghost-Assembly/{repo}",
            github + "/releases/latest",
        ),
        (
            "License",
            f"https://img.shields.io/github/license/Ghost-Assembly/{repo}",
            github + "/blob/main/LICENSE",
        ),
        (
            "GNOME",
            "https://img.shields.io/badge/GNOME-"
            + quote(" | ".join(metadata["shell-version"]), safe="")
            + "-blue",
            "https://ghost-assembly.com/" + repo + "/#install",
        ),
    ]:
        items.append(f"[![{label}]({image})]({link})")
    for label, metric in [
        ("Security issues", "software_quality_security_issues"),
        ("Reliability issues", "software_quality_reliability_issues"),
        ("Maintainability issues", "software_quality_maintainability_issues"),
        ("Duplication", "duplicated_lines_density"),
        ("Coverage", "coverage"),
    ]:
        api = "https://sonarcloud.io/api/measures/component?" + urlencode(
            {"component": "Ghost-Assembly_" + repo, "metricKeys": metric}
        )
        image = "https://img.shields.io/badge/dynamic/json?" + urlencode(
            {"url": api, "query": "$.component.measures[0].value", "label": label}
        )
        items.append(f"[![{label}]({image})]({sonar})")
    items.append(
        f"[![Sonar policy]({github}/actions/workflows/sonar.yml/badge.svg?branch=main)]({sonar})"
    )
    return "\n".join(items)


def render(root: Path) -> dict[Path, str]:
    """Generate common sections while preserving every unmarked project region."""
    metadata = json.loads((root / "metadata.json").read_text())
    project = json.loads((root / "docs/project.json").read_text())
    readme = (root / "README.md").read_text()
    page = (root / "docs/index.html").read_text()
    for name, items in blocks(metadata, project).items():
        readme = replace_block(readme, name, markdown(items))
        protected = markup(items).replace(
            html.escape(metadata["uuid"]),
            "<!--email_off-->" + html.escape(metadata["uuid"]) + "<!--/email_off-->",
        )
        page = replace_block(page, name, protected)
    readme = replace_block(readme, "badges", badges(project["repository"], metadata))
    readme = subprocess.run(
        ["/usr/bin/env", "node", "node_modules/prettier/bin/prettier.cjs", "--parser", "markdown"],
        cwd=root,
        input=readme,
        text=True,
        capture_output=True,
        check=True,
        timeout=30,
    ).stdout
    page = subprocess.run(
        ["/usr/bin/env", "node", "node_modules/prettier/bin/prettier.cjs", "--parser", "html"],
        cwd=root,
        input=page,
        text=True,
        capture_output=True,
        check=True,
        timeout=30,
    ).stdout
    return {root / "README.md": readme, root / "docs/index.html": page}


def main() -> None:
    """Write generated sections or check them without modifying source."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    stale = []
    for path, value in render(ROOT).items():
        if args.check:
            if path.read_text() != value:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.write_text(value)
    if stale:
        raise SystemExit("Stale generated docs: " + ", ".join(stale))
    print("PASS: shared documentation and badges are current")


if __name__ == "__main__":
    main()
