set shell := ["bash", "-euo", "pipefail", "-c"]

# This file is shared, byte for byte, by every Ghost Assembly GNOME Shell
# extension (see template.list). Recipes only this project needs live in
# project.just, imported at the end.

# Derived, so metadata.json is the only place the uuid is written down. Read
# with just's own functions rather than jq: every variable is evaluated before
# any recipe runs, so a jq here would stop `just setup` from ever getting as far
# as saying that jq is missing. The scripts still need jq, and setup checks it.
_uuid := replace_regex(read("metadata.json"), '(?s)^.*?"uuid"\s*:\s*"([^"]+)".*$', '$1')
uuid := if _uuid =~ '^[A-Za-z0-9._@-]+$' { _uuid } else { error("no uuid in metadata.json") }
name := replace_regex(uuid, '@.*$', '')
install_dir := env_var('HOME') / ".local/share/gnome-shell/extensions" / uuid

# stylesheet.css ships only in the projects that have one.
src := "metadata.json extension.js prefs.js modules schemas icons" + if path_exists("stylesheet.css") == "true" { " stylesheet.css" } else { "" }

# List available recipes
default:
    @just --list

# Install dependencies and dev tooling
setup:
    mise install
    npm ci
    npx playwright install chromium firefox
    @for pair in gjs:gjs glib-compile-schemas:glib2 gnome-shell:gnome-shell \
        gnome-extensions:gnome-shell rsync:rsync zip:zip unzip:unzip jq:jq; do \
        tool="${pair%%:*}"; package="${pair#*:}"; \
        command -v "$tool" >/dev/null \
            || { echo "missing $tool — dnf install $package"; exit 1; }; \
    done
    @test -x /usr/libexec/mutter-devkit \
        || echo "optional: just run needs mutter-devkit — dnf install mutter-devkit"
    @echo "ready"

# Format code in place
fmt:
    npx prettier --write .
    npx eslint --fix .

# Static analysis; changes nothing
lint: template-check
    npx eslint .
    npx prettier --check .
    glib-compile-schemas --strict --dry-run schemas
    shellcheck scripts/*.sh

# Check the files shared across the extensions against template.sha256; --write regenerates it
template-check *args:
    ./scripts/template-check.sh {{ args }}

# Run the unit suite
test *args:
    npx vitest run {{ args }}

# The docs site in Chromium and Firefox: accessibility, layout, no JavaScript
test-docs *args:
    npx playwright test {{ args }}

# Unit suite with a coverage report
coverage:
    npx vitest run --coverage

# None of it runs in CI: it needs a real Shell, and whatever live-extra in
# project.just probes. Builds first, so pack-check never compares a stale zip.
# Smoke-test in a headless gnome-shell, check the bundle, run any live-extra
test-live: build
    ./scripts/headless-check.sh
    ./scripts/pack-check.sh
    @if {{ just_executable() }} --justfile {{ justfile() }} --summary | tr ' ' '\n' | grep -qx live-extra; then \
        {{ just_executable() }} --justfile {{ justfile() }} live-extra; \
    fi

# Compare the built zip against what gnome-extensions pack produces
pack-check: build
    ./scripts/pack-check.sh

# Serve the documentation site locally
docs:
    @echo "http://localhost:8000"
    python3 -m http.server 8000 --directory docs

# Full local security scan
security:
    osv-scanner scan source --lockfile=package-lock.json
    gitleaks detect --no-banner --redact
    trivy fs --scanners vuln,secret,misconfig --exit-code 1 .
    actionlint
    zizmor .github/workflows/

# `ci` runs lint before this; a standalone `just build` deliberately does not,
# so it stays quick to iterate with.
# Produce the installable zip
build:
    rm -f {{ uuid }}.shell-extension.zip
    zip -qr {{ uuid }}.shell-extension.zip {{ src }} -x 'schemas/gschemas.compiled'
    @echo "built {{ uuid }}.shell-extension.zip"

# GNOME 49 and later have no nested mode: --devkit opens the Shell in a
# window through mutter-devkit (dnf install mutter-devkit).
# Run a gnome-shell in a window to try the extension by hand
run:
    dbus-run-session -- gnome-shell --devkit --wayland

# Copy the extension into the user extensions directory
install:
    mkdir -p {{ install_dir }}
    rsync -a --delete --exclude '.git' {{ src }} {{ install_dir }}/
    glib-compile-schemas {{ install_dir }}/schemas

# Enable the extension
enable:
    gnome-extensions enable {{ uuid }}

# Disable the extension
disable:
    gnome-extensions disable {{ uuid }}

# Open the preferences window
prefs:
    gnome-extensions prefs {{ uuid }}

# Follow the extension's log output
logs:
    journalctl -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered "{{ name }}"

# Remove build output
[confirm("remove node_modules, coverage, test output, the zip and compiled schemas?")]
clean:
    rm -rf node_modules coverage test-results playwright-report
    rm -f {{ uuid }}.shell-extension.zip schemas/gschemas.compiled

# Everything CI runs, in order
ci: lint test test-docs security build

import? 'project.just'
