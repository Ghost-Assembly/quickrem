# QuickRem

Your saved Remmina connections in Quick Settings, following the profile folder as it
changes.

Open the system menu, click the Remmina tile, pick a saved connection. The list
is read from Remmina's own profile directory and follows it as it changes, so a
connection saved in Remmina shows up here without a reload.

**[Documentation →](https://ghost-assembly.com/quickrem/)** — profiles, launching,
secrets, architecture, testing, packaging and releasing.

## What it does

- Lists every saved `.remmina` profile, sorted by name, with an icon per
  protocol.
- Watches the profile directory, so adding, editing or removing a profile
  updates the menu straight away. It also watches where detection looks, so
  installing Remmina after the extension, or setting `datadir_path` in
  Remmina's preferences, is picked up without logging out.
- Scrolls the list once it outgrows the screen, capped at half the work area.
  Short lists are untouched — no scrollbar appears until there is something to
  scroll.
- Opens a profile through the application registered for
  `application/x-remmina` — Remmina's own connect action. That works the same
  for a Flatpak and a distribution package, reuses an already-running Remmina,
  and lets the portal map the path into the Flatpak sandbox.
- Finds the profile directory on its own, honoring `datadir_path` in
  `remmina.pref`, and falls back to the Flatpak or native data directory.
- Reads only regular files, a symlink to one included, and at most 256 KiB of
  each, so nothing stray in the profile directory can stall or exhaust the
  Shell.

It never reads Remmina's stored passwords. `password`, `ssh_passphrase` and the
rest are encrypted with a key in `remmina.pref`, and `modules/profiles.js` drops
them while parsing rather than filtering them later.

## Install

Needs GNOME Shell 49 or 50, and Remmina. From the latest release, with no clone and
no toolchain — `gnome-extensions` ships with GNOME Shell itself:

```bash
curl -LO 'https://github.com/Ghost-Assembly/quickrem/releases/latest/download/quickrem@napalm255.github.io.shell-extension.zip'
gnome-extensions install --force 'quickrem@napalm255.github.io.shell-extension.zip'
# log out and back in, then
gnome-extensions enable quickrem@napalm255.github.io
```

That unpacks the extension and compiles its settings schema, so there is no
separate `glib-compile-schemas` step.

From a clone:

```bash
just setup
just install
just enable
```

A newly installed extension is not visible to a running Shell on Wayland, which
cannot reload the Shell in place: the first `enable` after a fresh install says
the extension does not exist. Log out and back in, then it works.

## Preferences

`just prefs`, or the Settings entry at the bottom of the menu. The first row
shows which directory QuickRem resolved and how, so a wrong guess is visible
rather than silent.

| Setting           | Empty means                                                        |
| ----------------- | ------------------------------------------------------------------ |
| Profile directory | Detect it: `datadir_path`, then a native install, then the Flatpak |
| Launch command    | Use the handler registered for `application/x-remmina`             |

A profile directory must be an absolute path or start with `~/`; anything else
is reported in that first row rather than guessed at.

`Launch command` is the escape hatch for an unusual install. The profile path is
appended as a separate argument, never interpolated into the string.

## Development

```bash
just              # list every recipe
just test         # unit suite, runs on Node
just test-docs    # the docs site, in Chromium and Firefox
just lint         # eslint, prettier, gschema and shellcheck
just ci           # everything CI runs
just fixtures 5   # write throwaway profiles to exercise the menu and watcher
just fixtures-clean
just test-live    # headless Shell smoke test, then the packer check
just logs         # follow the extension's output
```

`modules/profiles.js`, `modules/paths.js` and `modules/keyfile.js` import
nothing but each other, so Vitest runs them on plain Node. `modules/store.js` is
unit-tested against an in-memory Gio in `tests/stubs/` — FIFOs, device nodes and
symlinks included — which is what makes the debounces, the generation guards
and the watch re-attach reachable from a test.

`modules/launch.js` exists so the launch path can be tested at all: `panel.js`
imports St and QuickSettings, which a unit test cannot supply meaningfully, and
the launch code carries this extension's one security invariant — a profile path
is its own argument-vector element and is never interpolated into
`launch-command`, so a profile named with a semicolon is an argument rather than
a second command. A test fails if that stops being true.

`prefs.js` is unit-tested too, mostly to pin one trap: `_()` may not be called
while a module is being evaluated, and a translated string in a module-level
table stops the preferences window opening at all — silently, because nothing
else in the extension imports `prefs.js`.

`modules/panel.js` is unit-tested against stubs of St and the Shell's menus.
Those stubs model the Shell behaviors the panel has to work around — the Shell
never destroys a quick toggle's menu, and a quick toggle's menu measures the
height it animates to before it announces that it is opening — because a
headless smoke test that only reads the log saw neither.

`extension.js` only pairs construction with teardown. It is covered by
`scripts/headless-check.sh`, which enables, disables and re-enables the real
extension in a real headless gnome-shell and fails on a JavaScript error or a
lifetime warning.

## Architecture

| File                  | Platform imports                    | Job                                                  |
| --------------------- | ----------------------------------- | ---------------------------------------------------- |
| `extension.js`        | Shell (Extension, Main)             | Pair construction with teardown, nothing else        |
| `modules/keyfile.js`  | none                                | Read one group of a GKeyFile, exact keys only        |
| `modules/profiles.js` | none                                | Parse a `.remmina` file, sort, map protocol to icon  |
| `modules/paths.js`    | none                                | Decide which directory to read                       |
| `modules/io.js`       | Gio, GLib                           | Asynchronous probes, and bounded reads of text files |
| `modules/detect.js`   | GLib                                | Probe the system and apply the rules in `paths.js`   |
| `modules/store.js`    | Gio, GLib, GObject                  | Scan and watch it; publish `profiles` and `source`   |
| `modules/launch.js`   | Gio, GLib, Shell                    | Decide what to run, and with which arguments         |
| `modules/panel.js`    | Clutter, Gio, GObject, Pango, St, … | The tile, its menu and its rows                      |
| `prefs.js`            | Adw, Gio, GObject                   | Preferences, in its own process                      |

"none" means the module imports only other modules that import none, which is
what lets Vitest run it on plain Node and the preferences process load it. The
`…` for `modules/panel.js` is the Shell's own UI modules: Main, PopupMenu,
QuickSettings and animationUtils.

The store owns the data and the panel owns the widgets; the panel rebuilds on
the store's `changed` signal and holds no profile state of its own.

### Why the list scrolls

`QuickToggleMenu` has no scrolling of its own. Measured on a 1080p screen, 30
profiles want 1296px of a 1048px work area and the surplus is simply clipped.
GNOME's own Wi-Fi menu answers this by showing eight networks and sending you to
Settings for the rest, which suits a list you skim but not one you pick from.

So `modules/panel.js` subclasses `PopupMenuSection` and swaps its `actor` for an
`St.ScrollView` around the same box. `PopupMenuBase.addMenuItem()` adds
`section.actor` and does its bookkeeping against the section object, so key
navigation, open-state propagation and activation all survive the swap. The cap
is recomputed just before every open and on a rebuild while the menu is open,
which picks up a monitor or text-scaling change without watching for either. It
has to come before the open: the menu measures the height it animates to first
and only then says it is opening.

## Contributing

Everything lands through a pull request whose title is a Conventional Commit.
See [AGENTS.md](AGENTS.md) for the repository's conventions.

```bash
git switch -c type/short-description
just ci
gh pr create --fill
gh pr merge --squash --auto
```

## Releasing

Set the version in `metadata.json` and `package.json` and land that through a
pull request like anything else. Then tag the merged commit on `main` and push
the tag — tags are not covered by branch protection:

```bash
git switch main && git pull
git tag -a v0.1.2 -m 'release v0.1.2'
git push origin v0.1.2
```

CI checks the tag against both files before it builds anything, so a tag that
disagrees with the tree fails instead of shipping a mislabeled zip.

## License

GPL-3.0-or-later.
