#!/usr/bin/env bash
# Check the files the Ghost Assembly extensions share against template.sha256.
#
# template.list names the shared files, one path per line. template.sha256
# holds their checksums, and is identical in every extension that shares the
# same list, so drift shows from the parent directory in one command:
#
#     sort quick*/template.sha256 | uniq -c | sort -n
#
# Any line counted fewer times than there are repositories is a file that
# differs somewhere.
#
# To change a shared file: make the same change in every extension, then run
# `just template-check --write` in each.
#
#     scripts/template-check.sh           verify; exit 1 on any difference
#     scripts/template-check.sh --write   regenerate template.sha256

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

LIST=template.list
SUMS=template.sha256

usage() {
    echo "usage: $0 [--write]" >&2
    exit 2
}

[[ -f "$LIST" ]] || {
    echo "FAIL: $LIST not found" >&2
    exit 1
}

# Blank lines and # comments are allowed in the list; everything else is a path.
mapfile -t paths < <(grep -vE '^[[:space:]]*(#|$)' "$LIST")
((${#paths[@]} > 0)) || {
    echo "FAIL: $LIST names no files" >&2
    exit 1
}

case "${1:-}" in
    --write)
        (($# == 1)) || usage
        sha256sum -- "${paths[@]}" >"$SUMS"
        echo "wrote $SUMS for ${#paths[@]} files"
        ;;
    "")
        [[ -f "$SUMS" ]] || {
            echo "FAIL: $SUMS not found; run 'just template-check --write'" >&2
            exit 1
        }

        # The manifest must cover exactly the list, or a path added to one and
        # not the other would never be checked.
        if ! diff -u --label "$LIST" --label "$SUMS" \
            <(printf '%s\n' "${paths[@]}" | LC_ALL=C sort) \
            <(sed -E 's/^[0-9a-f]{64} [ *]//' "$SUMS" | LC_ALL=C sort) >&2; then
            echo "FAIL: $LIST and $SUMS name different files" >&2
            exit 1
        fi

        if ! sha256sum --check --strict --quiet "$SUMS"; then
            echo "FAIL: a shared file differs from $SUMS." >&2
            echo "Change it in every extension, then run 'just template-check --write' in each." >&2
            exit 1
        fi
        echo "ok: ${#paths[@]} shared files match $SUMS"
        ;;
    *)
        usage
        ;;
esac
