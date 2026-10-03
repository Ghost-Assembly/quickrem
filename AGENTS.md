# Working on QuickRem

QuickRem is a GNOME Shell extension: one Quick Settings tile that lists every
connection saved in Remmina and opens one through Remmina. README.md is for
humans; this file holds the rules an agent needs before touching the tree.

## What gets published

- `just build` produces `quickrem@napalm255.github.io.shell-extension.zip`.
  A `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which verifies
  version agreement, main ancestry, and successful CI for the exact commit,
  then publishes that tested artifact without rebuilding it.
- Docs at https://ghost-assembly.com/quickrem/ are deployed by the Pages
  workflow from the tested `docs/` artifact after all required checks pass on main.
- GNOME Extension Store submission and review remain manual.

## Commands

Tool versions live in `mise.toml`; common commands live in the canonical
`justfile`; project-specific commands and hooks live in `project.just`.
Run `just ci` before claiming a change works.

| Command                                                                | Does                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `just setup`                                                           | Install pinned tools, npm development dependencies, and Chromium/Firefox; check host tools      |
| `just fmt`                                                             | Format JavaScript, Python, configuration, and generated documentation                           |
| `just lint`                                                            | Verify canonical files, generated docs, ESLint, Prettier, Ruff, schemas, and shell scripts      |
| `just template-check`                                                  | Compare managed files with the immutable GitHub revision in `quick-template.lock.json`          |
| `just template-sync SHA`                                               | Synchronize a reviewed canonical revision; then install dependencies and regenerate docs        |
| `just test`                                                            | Run Vitest, Python tooling tests, and project offline integration tests                         |
| `just coverage`                                                        | Measure runtime JavaScript and Python tooling, including untested files                         |
| `just test-docs`                                                       | Check docs in Chromium and Firefox, including axe accessibility audits                          |
| `just security`                                                        | Run OSV, source and history secret scans, Trivy, actionlint, and Zizmor                         |
| `just build`                                                           | Build a deterministic runtime-only ZIP with Python's standard library                           |
| `just pack-check`                                                      | Compare every ZIP filename and byte with GNOME's official packer; validate icons                |
| `just test-live`                                                       | Check packaging, then isolated GNOME lifecycle and project integration hooks                    |
| `just run`                                                             | Run GNOME Shell in a development window                                                         |
| `just install` / `enable` / `disable` / `uninstall` / `prefs` / `logs` | Work with the extension in your logged-in session                                               |
| `just docs`                                                            | Serve the static site at localhost:8000                                                         |
| `just ci`                                                              | Run lint, tests, coverage, docs, security, and packaging; GitHub also requires CodeQL and Sonar |
| `just clean`                                                           | Confirm before removing generated build and test output                                         |

Live checks require an installed GNOME Shell and run outside hosted CI.
Complete the manual checklist and test each declared GNOME version before releasing.

Project commands: `just fixtures COUNT` creates throwaway Remmina profiles;
`just fixtures-clean` removes them.

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
  `scripts/build.py --check` diffs the built zip against `gnome-extensions pack`.

`tests/stubs/` holds the fakes (`gi-*.js` for GI namespaces, `shell-*.js` for
Shell classes, `settings.js` for `Gio.Settings`); `tests/support/actors.js`
holds shared widget-actor fakes used by the panel tests.

## Conventions

- Conventional Commits; PRs land through a squash merge whose title is the
  Conventional Commit subject.
- `main` is protected: no direct pushes, no force-pushes, no merge commits.
  The required `ci` check includes CodeQL and Sonar, and the branch must be current with `main`; no
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
- Shared tooling comes from the pinned canonical `quick-template` revision.
  Keep local hooks in `project.just` and generated documentation current.

## Template files

`quick-template.lock.json` pins a full commit SHA from
`Ghost-Assembly/quick-template`. `just template-check` compares managed files
with that immutable GitHub archive; a local manifest cannot approve drift.
Change shared tooling in the canonical repository, then run
`just template-sync SHA`, `npm ci --ignore-scripts`, `just docs-generate`, and
`just ci` in this checkout. The weekly freshness check reports newer approved
releases without adopting them automatically.

Project hooks belong in `project.just`, runtime packaging inputs in
`quick-project.json`, documentation identity in `docs/project.json`, and local
styling in `docs/project.css`. Common README and site sections are generated;
keep extension-specific content outside their markers. Lifecycle test scripts
remain specific to the extension.

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
