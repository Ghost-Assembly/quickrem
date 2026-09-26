#!/usr/bin/env bash
# Boot a throwaway headless gnome-shell with the extension installed and assert
# that it enables cleanly, disables cleanly, and can be enabled again without
# leaking.
#
# The enable/disable/enable cycle is the point: a signal connected at enable
# and never disconnected makes the second enable stack a second handler, and
# the Shell warns.
#
# This needs a real gnome-shell and so runs locally only; GitHub's runners have
# no GNOME 50.
#
# Recommended frame, NOT in template.list: everything outside the marked
# per-repo block is the same in every extension; the block holds what only
# this one checks. Keep the frame in step by hand.

set -euo pipefail

# The system's GLib tools, not whichever are first on PATH. A Homebrew GLib
# (pulled in as a dependency of something else) ships its own gsettings built
# without the dconf module: it silently falls back to a keyfile, the value
# reads back fine from gsettings itself, and the shell under test never sees
# it — so the extension is never enabled and the check times out with no
# error. Everything here must speak to the same GLib gnome-shell was built
# against.
export PATH="/usr/bin:$PATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Derived, so metadata.json is the only place the uuid is written down. It was
# spelled out here once, and a rename then left this script installing under one
# uuid and enabling another — which fails as "extension not found", nowhere near
# the line that is actually wrong.
UUID="$(jq -r .uuid "$REPO_ROOT/metadata.json")"
NAME="${UUID%%@*}"
TIMEOUT="${TIMEOUT:-60}"

# The private XDG directories must be exported BEFORE dbus-run-session starts,
# not after. D-Bus activates dconf as a child of the bus, so a service started
# by a bus that inherited the real XDG_CONFIG_HOME will read and write the
# developer's own dconf database — `gsettings set` then silently affects the
# real session and the shell under test loads the real extension list.
if [[ -z "${HEADLESS_CHECK_WORK:-}" ]]; then
    HEADLESS_CHECK_WORK="$(mktemp -d)"
    export HEADLESS_CHECK_WORK
    export XDG_CONFIG_HOME="$HEADLESS_CHECK_WORK/config"
    export XDG_DATA_HOME="$HEADLESS_CHECK_WORK/data"
    export XDG_CACHE_HOME="$HEADLESS_CHECK_WORK/cache"
    export XDG_RUNTIME_DIR="$HEADLESS_CHECK_WORK/run"
    mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
    chmod 700 "$XDG_RUNTIME_DIR"

    exec dbus-run-session -- "${BASH_SOURCE[0]}" "$@"
fi

WORK="$HEADLESS_CHECK_WORK"
LOG="$WORK/shell.log"

# Background helpers the per-repo block starts (a fake player, a wl-copy);
# cleanup stops every one.
HELPER_PIDS=()

# ==== BEGIN per-repo assertions =============================================
# Everything particular to this extension. The frame calls these four hooks at
# fixed points; leave a hook as `:` when there is nothing to do there.
#
# before_shell  — after the extension is installed, before gnome-shell starts:
#                 fixtures, settings (`gsettings --schemadir "$EXT_DIR/schemas"`).
# after_enable  — once the first "[$NAME] enabled" is logged.
# after_reenable — once the second "[$NAME] enabled" is logged.
# final_checks  — after the shared error and warning greps.
#
# Helpers available: wait_for PATTERN [COUNT], fail MESSAGE, and HELPER_PIDS
# for anything started in the background.

# Warnings this extension may legitimately log in a headless Shell, as one
# extended regex matched against the warning's text; empty allows none.
ALLOWED_WARNINGS=''

# The isolated XDG_DATA_HOME has no Remmina, so a planted profile directory is
# what makes the scan, the parse and the file monitor all run rather than
# being skipped.
PROFILE_DIR="$WORK/profiles"

before_shell() {
    mkdir -p "$PROFILE_DIR"
    printf '[remmina]\nname=Headless Fixture\nprotocol=SSH\nserver=example.com\n' \
        >"$PROFILE_DIR/fixture.remmina"

    gsettings --schemadir "$EXT_DIR/schemas" \
        set org.gnome.shell.extensions.quickrem profile-dir "$PROFILE_DIR"
}

after_enable() {
    # Exercise the file monitor while the Shell is live: a profile appearing
    # must not throw, and neither must one going away.
    printf '[remmina]\nname=Added Later\nprotocol=RDP\nserver=rdp.example.com\n' \
        >"$PROFILE_DIR/added.remmina"
    sleep 2
    rm -f "$PROFILE_DIR/added.remmina"
    sleep 2
    echo "ok: file monitor survived an add and a remove"
}

after_reenable() {
    :
}

final_checks() {
    :
}
# ==== END per-repo assertions ===============================================

EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR"
# icons/ included: without it Gio.icon_new_for_string points at a path that does
# not exist, the tile draws no icon, and nothing is logged to say so.
cp -r "$REPO_ROOT"/metadata.json "$REPO_ROOT"/extension.js "$REPO_ROOT"/prefs.js \
    "$REPO_ROOT"/modules "$REPO_ROOT"/schemas "$REPO_ROOT"/icons "$EXT_DIR/"
# The same condition `just build` ships it on.
if [[ -f "$REPO_ROOT/stylesheet.css" ]]; then
    cp "$REPO_ROOT/stylesheet.css" "$EXT_DIR/"
fi
glib-compile-schemas "$EXT_DIR/schemas"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$UUID']"

# Guard against the isolation failing: if dconf were leaking into the real
# session, this would come back holding the developer's extensions.
enabled="$(gsettings get org.gnome.shell enabled-extensions)"
if [[ "$enabled" != "['$UUID']" ]]; then
    echo "FAIL: dconf is not isolated; enabled-extensions = $enabled" >&2
    rm -rf "$WORK"
    exit 1
fi

# And read it back through dconf itself, not gsettings: a gsettings built
# without the dconf module writes to a keyfile, reads its own write back and
# passes the guard above, while the Shell reads dconf and sees nothing.
if [[ "$(dconf read /org/gnome/shell/enabled-extensions)" != "['$UUID']" ]]; then
    echo "FAIL: gsettings is not writing to dconf; check which gsettings is on PATH" >&2
    rm -rf "$WORK"
    exit 1
fi

before_shell

# The enable marker is logged at debug level, which GLib drops unless asked
# for. Without this the shell starts perfectly and the check still fails.
export G_MESSAGES_DEBUG=all

gnome-shell --wayland --headless --virtual-monitor 3840x1600 >"$LOG" 2>&1 &
SHELL_PID=$!
# shellcheck disable=SC2317  # invoked via trap
cleanup() {
    # Captured first: this trap's own last command would otherwise become the
    # script's exit status, which is how a run that printed PASS still exited 1.
    local status=$?

    # A helper has often exited on its own by now, so kill may fail; under
    # `set -e` that would abort the trap and turn a PASS into exit 1.
    local pid
    for pid in "${HELPER_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    kill "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true

    # D-Bus activates gvfs inside the throwaway XDG_RUNTIME_DIR, and its fuse
    # mount is not ours to unmount, so the directory may refuse to go. Leaving a
    # few files in /tmp must not turn a passing check into a failing one.
    rm -rf "$WORK" 2>/dev/null || true

    return "$status"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $1" >&2
    echo "---- shell log ($NAME and errors only) ----" >&2
    grep -aiE "$NAME|JS ERROR|Extension" "$LOG" >&2 || echo "(nothing matched)" >&2
    exit 1
}

# Counts occurrences rather than truncating between phases: gnome-shell keeps
# the log open, so truncating leaves its file offset intact and the next write
# pads the gap with NULs — grep then reports "binary file matches" and the
# failure diagnostics come out empty at exactly the wrong moment.
wait_for() {
    local pattern="$1" wanted="${2:-1}" waited=0
    while ((waited < TIMEOUT)); do
        (($(grep -ac "$pattern" "$LOG") >= wanted)) && return 0
        kill -0 "$SHELL_PID" 2>/dev/null || fail "gnome-shell exited early"
        sleep 1
        # Not ((waited++)): that evaluates to 0 on the first pass, which is a
        # failing status, and set -e would end the script there.
        waited=$((waited + 1))
    done
    return 1
}

wait_for "\\[$NAME\\] enabled" || fail "extension never reported enabled within ${TIMEOUT}s"
echo "ok: enabled"
after_enable

# A second enable must be as clean as the first.
gnome-extensions disable "$UUID"
sleep 3
gnome-extensions enable "$UUID"
wait_for "\\[$NAME\\] enabled" 2 || fail "extension did not re-enable after disable"
echo "ok: re-enabled after disable"
after_reenable

if grep -qaE 'JS ERROR|Extension .* had error' "$LOG"; then
    fail "javascript errors in the shell log"
fi

if grep -qaiE 'No signal handler|instance with invalid|Object .* has been already deallocated' "$LOG"; then
    fail "signal or object lifetime warnings after re-enable"
fi

if grep -qaiE 'Source ID .* was not found|GSource .* still active' "$LOG"; then
    fail "a GLib source outlived its disable"
fi

# Anything the extension logged through console.warn or console.error. GJS
# prints those as "Gjs-Console-WARNING **: <time>: <text>" (CRITICAL for
# error), while console.debug and console.log never carry that level.
warnings="$(grep -aE "Gjs-Console-(WARNING|CRITICAL) \\*\\*: [0-9:.]+: \\[$NAME\\]" "$LOG" || true)"
if [[ -n "$ALLOWED_WARNINGS" ]]; then
    warnings="$(grep -vE "$ALLOWED_WARNINGS" <<<"$warnings" || true)"
fi
if [[ -n "$warnings" ]]; then
    echo "$warnings" >&2
    fail "the extension logged a warning"
fi

echo "ok: no errors or lifetime warnings"
final_checks
echo "PASS"
