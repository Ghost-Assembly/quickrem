# Working on QuickRem

QuickRem is a GNOME Shell extension: one Quick Settings tile that lists every
connection saved in Remmina and opens one through Remmina. README.md is for
humans; this file holds the rules an agent needs before touching the tree.

## What gets published

- The artifact is `quickrem@napalm255.github.io.shell-extension.zip`
  (`just build`), attached to a GitHub release by `.github/workflows/release.yml`.
- The docs site is `docs/index.html` and its assets, published at
  `https://ghost-assembly.com/quickrem/` (GitHub Pages source: `docs/` on `main`).
- A tag `vX.Y.Z` pushed to `main` triggers the release workflow, which refuses
  to build unless `metadata.json`'s `version-name` and `package.json`'s
  `version` both equal the tag.

## Commands

| Command                                                  | Does                                                                                              | Needs                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `just setup`                                             | `mise install`, `npm ci`, Playwright browsers, checks for `gjs`/`gnome-shell`/etc.                | —                                            |
| `just fmt`                                               | prettier + eslint --fix                                                                           | —                                            |
| `just lint`                                              | template-check, eslint, prettier --check, gschema strict dry-run, shellcheck                      | —                                            |
| `just template-check`                                    | diffs the shared files against `template.sha256`                                                  | —                                            |
| `just test`                                              | Vitest unit suite                                                                                 | —                                            |
| `just test-docs`                                         | Playwright: docs site in Chromium + Firefox (axe, no JS, no third-party requests, 360px)          | —                                            |
| `just coverage`                                          | Vitest with a coverage report                                                                     | —                                            |
| `just security`                                          | osv-scanner, gitleaks, trivy, actionlint, zizmor                                                  | —                                            |
| `just build`                                             | zips the extension                                                                                | —                                            |
| `just ci`                                                | `lint test test-docs security build` — what CI runs                                               | —                                            |
| `just test-live`                                         | headless-check.sh + pack-check.sh (+ `fixtures`/`fixtures-clean` from `project.just`)             | a real headless `gnome-shell`; not run in CI |
| `just run`                                               | `gnome-shell --devkit --wayland` in a window                                                      | `mutter-devkit`, a real Shell session        |
| `just install` / `enable` / `disable` / `prefs` / `logs` | install into `~/.local/share/gnome-shell/extensions`, toggle it, open preferences, follow its log | a real GNOME Shell session                   |
| `just docs`                                              | serves `docs/` on `localhost:8000`                                                                | —                                            |
| `just clean`                                             | removes build/test output                                                                         | —                                            |

Run `just ci` before claiming anything done.

## Hard constraints

- **Never read Remmina's stored passwords.** `password`, `ssh_passphrase` and
  every other secret key are encrypted with a key in `remmina.pref`.
  `modules/profiles.js` drops them _while parsing_ a profile, using
  `modules/keyfile.js`'s `keep` callback (a key it rejects is never unescaped
  or stored) — filtering afterwards instead of at parse time is not
  equivalent and is not acceptable. `remmina.pref` is read for one key,
  `datadir_path`: `modules/paths.js`'s `parseDatadirPath` (called from
  `readDatadirPath`, in turn called from `modules/detect.js`) uses the same
  `keyfile.js` `readGroup` with a keep-only-`datadir_path` filter, so the
  `secret=` beside it — the key Remmina encrypts stored passwords with — is
  never returned and never kept.
- **A profile path is its own `argv` element, never interpolated.**
  `modules/launch.js`'s `spawnOverride` parses `launch-command` with
  `GLib.shell_parse_argv` and then appends the path as a separate element, so
  a profile named with a semicolon is an argument, not a second command. A
  change to the launch path must keep this true; there is a test for it.
- **Decisions live in gi-free modules.** `modules/paths.js`, `modules/profiles.js`
  and `modules/keyfile.js` import nothing (not even `gi://Gio`), which is what
  lets Vitest run them on plain Node and lets `prefs.js`'s own process load
  them safely. Do not add a GI import to one of these to make a feature
  easier — move the GI-touching part to `modules/io.js`, `modules/detect.js`,
  `modules/store.js`, `modules/launch.js` or `modules/panel.js` instead.
- **Reads are asynchronous and bounded.** `modules/io.js`'s `readText` refuses
  anything over `MAX_FILE_BYTES` (256 KiB) and opens only regular files (a
  symlink to one is followed); a FIFO or device node is skipped without being
  opened. A synchronous or unbounded read in the Shell process can stall or
  exhaust the whole desktop, not just this menu.

## Tests

Failing test first (RED → GREEN). Layers:

- **Vitest** (`just test`) — `modules/profiles.js`, `modules/paths.js` and
  `modules/keyfile.js` run exactly as shipped, on plain Node.
  `modules/store.js` runs against an in-memory Gio in `tests/stubs/` (FIFOs,
  device nodes and symlinks included). `modules/panel.js` runs against stubs
  of St and the Shell's menu classes that model what the Shell actually does
  (it never destroys a quick toggle's menu; a toggle's menu measures its
  height before it announces it is opening). `prefs.js` is tested mostly to
  pin one trap: a translated string built while the module loads throws, and
  the preferences window then never opens, silently.
- **`just test-docs`** (Playwright, Chromium + Firefox) — the docs site:
  accessibility (axe, both color schemes), no JavaScript, no request to
  another origin, no sideways scroll at 360px.
- **`just test-live`** (not in CI — needs a real headless `gnome-shell`) —
  `scripts/headless-check.sh` enables, disables and re-enables the real
  extension and fails on a JavaScript error or a lifetime warning, then
  `scripts/pack-check.sh` diffs the built zip against `gnome-extensions pack`.

`tests/stubs/` holds the fakes (`gi-*.js` for GI namespaces, `shell-*.js` for
Shell classes, `settings.js` for `Gio.Settings`); `tests/support/actors.js`
holds shared widget-actor fakes used by the panel tests.

## Conventions

- Conventional Commits; PRs land through a squash merge whose title is the
  Conventional Commit subject.
- `main` is protected: no direct pushes, no force-pushes, no merge commits.
  `ci` and `CodeQL` must pass and the branch must be current with `main`; no
  approving review is required, so a single maintainer is not locked out of
  their own repository.
- Third-party GitHub Actions pinned by commit SHA; container images by digest.
- American English throughout (prose, comments, identifiers, commit messages).
- Nothing personal in code, tests, fixtures or docs.
- Committed docs: `README.md`, `docs/index.html`, `SECURITY.md`, `AGENTS.md`,
  and `CLAUDE.md` (which is exactly `@AGENTS.md`).

## Cross-repo duties

- The one-liner — "Your saved Remmina connections in Quick Settings,
  following the profile folder as it changes." — must stay identical in
  `README.md` line 1, `metadata.json`'s `description`, the Ghost Assembly hub
  card, the hub's profile row, and this repo's GitHub "About" description.
- Template sync: every path in `template.list` is shared byte-for-byte with
  the other `quick*` extensions and is checked by `just template-check`
  (part of `just lint`). A deliberate change to one of those files has to
  land in every repo that shares it, then `just template-check --write` to
  regenerate `template.sha256` here.

## Template files

`template.list` here is quickrem's **own** 23-path list, not a list shared
byte-for-byte with every other extension — some `quick*` repos share a longer,
29-path list; quickrem does not carry the entries that do not apply to it.
`just template-check` verifies the files it does list against `template.sha256`.

Project-specific files that are _not_ in `template.list`, and so are free to
edit here without touching another repo, include `project.just` (the
`fixtures`/`fixtures-clean` recipes), `docs/project.css` (this project's
additions to the shared docs stylesheet) and `tests/docs.config.js` (this
site's title, URL, section list and drawing checks).

`tests/stubs/` holds sixteen fakes for GI namespaces and Shell classes. Five
are template-locked (`gi-gobject.js`, `gi-meta.js`, `gi-pango.js`,
`gi-shell.js`, `shell-extension.js`) and must not be hand-edited here. The
other eleven — `gi-adw.js`, `gi-clutter.js`, `gi-gio.js`, `gi-glib.js`,
`gi-st.js`, `settings.js`, `shell-animation-utils.js`, `shell-main.js`,
`shell-popupmenu.js`, `shell-prefs.js` and `shell-quicksettings.js` — are
quickrem's own design and can be changed freely; so is `tests/support/actors.js`.

## Settings keys

There is no `modules/settings.js`: quickrem has only two keys, and the
gschema is their single source. `schemas/org.gnome.shell.extensions.quickrem.gschema.xml`
defines `profile-dir` and `launch-command`; `prefs.js` binds both directly to
`Adw.EntryRow` widgets and computes the status row's text from them, and
`modules/store.js`, `modules/launch.js` and `modules/panel.js` read them
straight off the `Gio.Settings` object the extension passes in. Add a key to
the schema first, run `just lint` (which dry-run compiles it), then wire it
into `prefs.js` and whichever module needs it — never invent a key that is
not in the schema.
