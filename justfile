set shell := ["bash", "-euo", "pipefail", "-c"]
_uuid := replace_regex(read("metadata.json"), '(?s)^.*?"uuid"\s*:\s*"([^"]+)".*$', '$1')
uuid := if _uuid =~ '^[A-Za-z0-9._@-]+$' { _uuid } else { error("invalid extension UUID") }
_name := replace_regex(read("package.json"), '(?s)^.*?"name"\s*:\s*"([^"]+)".*$', '$1')
project_name := if _name =~ '^quick[a-z]+$' { _name } else { error("invalid project name") }

# List project commands
default:
    @just --list

# Install the exact toolchain, dependencies, and browser engines
setup:
    mise install
    npm ci --ignore-scripts
    ./node_modules/.bin/playwright install chromium firefox
    @for tool in gjs glib-compile-schemas gnome-extensions jq; do command -v "$tool" >/dev/null || { echo "missing host tool: $tool; use a development container if needed" >&2; exit 1; }; done

# Format source and generated documentation
fmt:
    ./node_modules/.bin/prettier --write .
    ./node_modules/.bin/eslint --fix .
    ruff format scripts tests
    ruff check --fix scripts tests
    python3 scripts/docs.py

# Verify canonical files, documentation, source, and schemas
lint: template-check docs-check
    ./node_modules/.bin/eslint --max-warnings=0 --no-inline-config .
    ./node_modules/.bin/prettier --check .
    ruff check --ignore-noqa scripts tests
    ruff format --check scripts tests
    /usr/bin/glib-compile-schemas --strict --dry-run schemas
    @if compgen -G 'scripts/*.sh' >/dev/null; then shellcheck scripts/*.sh; fi

# Verify against the immutable canonical template
template-check:
    python3 scripts/template.py check

# Adopt a reviewed canonical revision
template-sync $revision:
    python3 scripts/template.py sync "$revision"

# Report newer approved template revisions
template-status:
    python3 scripts/template.py status

# Regenerate shared instructions and README badges
docs-generate:
    python3 scripts/docs.py

# Fail on stale generated documentation
docs-check:
    python3 scripts/docs.py --check

# Run offline behavior tests and shared tooling regressions
test *args:
    ./node_modules/.bin/vitest run {{args}}
    python3 -m unittest discover -s tests -p 'test_*.py' -v
    just test-extra

# Measure all JavaScript runtime source
coverage:
    ./node_modules/.bin/vitest run --coverage

# Test static documentation in Chromium and Firefox
test-docs *args:
    ./node_modules/.bin/playwright test {{args}}

# Check dependencies, working files, Git history, and workflow security
security:
    osv-scanner scan source --lockfile=package-lock.json
    python3 scripts/security_source.py
    gitleaks git --redact --no-banner .
    python3 scripts/workflow_lint.py
    zizmor --offline --persona auditor --no-ignores .github/workflows/

# Build an explicit runtime-only ZIP
build:
    python3 scripts/build.py

# Compare every runtime file with GNOME's official packer
pack-check: build
    python3 scripts/build.py --check
    @for icon in icons/*.svg; do [[ ! -f "$icon" ]] || /usr/bin/gjs -m scripts/icon-check.js "$icon"; done

# Perform isolated lifecycle and project integration checks
test-live: pack-check
    just live-check
    just live-extra

# Run GNOME in a development window
run:
    /usr/bin/dbus-run-session -- /usr/bin/gnome-shell --devkit --wayland

# Install the same ZIP used for releases
install: build
    /usr/bin/gnome-extensions install --force '{{uuid}}.shell-extension.zip'

# Enable the installed extension
enable:
    /usr/bin/gnome-extensions enable '{{uuid}}'

# Disable the installed extension
disable:
    /usr/bin/gnome-extensions disable '{{uuid}}'

# Remove the extension while preserving user data
uninstall:
    just uninstall-extra
    /usr/bin/gnome-extensions disable '{{uuid}}'
    /usr/bin/gnome-extensions uninstall '{{uuid}}'

# Open preferences
prefs:
    /usr/bin/gnome-extensions prefs '{{uuid}}'

# Follow GNOME Shell logs
logs:
    journalctl --user -f -o cat /usr/bin/gnome-shell --grep '\[{{project_name}}\]'

# Serve the static documentation site
docs:
    python3 -m http.server 8000 --bind 127.0.0.1 --directory docs

# Remove generated output only
[confirm("Remove generated test and build output?")]
clean:
    python3 scripts/clean.py

# Run all local checks; GitHub additionally requires CodeQL and Sonar
ci: lint test coverage test-docs security pack-check

import 'project.just'
