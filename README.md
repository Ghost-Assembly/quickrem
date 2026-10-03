# QuickRem

<!-- quick-template:badges:start -->

[![CI](https://github.com/Ghost-Assembly/quickrem/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Ghost-Assembly/quickrem/actions/workflows/ci.yml)
[![Security](https://github.com/Ghost-Assembly/quickrem/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Ghost-Assembly/quickrem/actions/workflows/security.yml)
[![Docs](https://img.shields.io/website?url=https%3A%2F%2Fghost-assembly.com%2Fquickrem%2F&label=docs)](https://ghost-assembly.com/quickrem/)
[![Release](https://img.shields.io/github/v/release/Ghost-Assembly/quickrem)](https://github.com/Ghost-Assembly/quickrem/releases/latest)
[![License](https://img.shields.io/github/license/Ghost-Assembly/quickrem)](https://github.com/Ghost-Assembly/quickrem/blob/main/LICENSE)
[![GNOME](https://img.shields.io/badge/GNOME-49%20%7C%2050-blue)](https://ghost-assembly.com/quickrem/#install)
[![Security issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickrem%26metricKeys%3Dsoftware_quality_security_issues&query=%24.component.measures%5B0%5D.value&label=Security+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickrem)
[![Reliability issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickrem%26metricKeys%3Dsoftware_quality_reliability_issues&query=%24.component.measures%5B0%5D.value&label=Reliability+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickrem)
[![Maintainability issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickrem%26metricKeys%3Dsoftware_quality_maintainability_issues&query=%24.component.measures%5B0%5D.value&label=Maintainability+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickrem)
[![Duplication](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickrem%26metricKeys%3Dduplicated_lines_density&query=%24.component.measures%5B0%5D.value&label=Duplication)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickrem)
[![Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickrem%26metricKeys%3Dcoverage&query=%24.component.measures%5B0%5D.value&label=Coverage)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickrem)
[![Sonar policy](https://github.com/Ghost-Assembly/quickrem/actions/workflows/sonar.yml/badge.svg?branch=main)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickrem)
<!-- quick-template:badges:end -->

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

## Preferences

`just prefs`, or the Settings entry at the bottom of the menu. The first row
shows which directory QuickRem resolved and how, so a wrong guess is visible
rather than silent.

| Setting           | Empty means                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| Profile directory | Detect it: `datadir_path`, then a native install, then the Flatpak        |
| Launch command    | Open a profile through the handler registered for `application/x-remmina` |

A profile directory must be an absolute path or start with `~/`; anything else
is reported in that first row rather than guessed at.

`Launch command` is the escape hatch for an unusual install. The profile path is
appended as a separate argument, never interpolated into the string. With it
empty, opening a profile goes through the `application/x-remmina` handler and
`Open Remmina…` goes through `org.remmina.Remmina.desktop` via
`Shell.AppSystem`; a command set here is used for both instead.

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

## Install

<!-- quick-template:install:start -->

Requires GNOME Shell 49 or 50. Requires Remmina and its saved connection profiles.

### From a release

Download the latest release ZIP and install it for your user. xh is a download tool; you can also download the ZIP from GitHub in a browser. Installing compiles the settings schema.

```sh
xh --download GET https://github.com/Ghost-Assembly/quickrem/releases/latest/download/quickrem@napalm255.github.io.shell-extension.zip
gnome-extensions install --force quickrem@napalm255.github.io.shell-extension.zip
```

Log out and back in so GNOME discovers the extension, then enable it:

```sh
gnome-extensions enable quickrem@napalm255.github.io
```

### From a clone

Install mise and activate it in your shell. Clone the repository, install its pinned tools, and build and install the same ZIP used for releases:

```sh
git clone https://github.com/Ghost-Assembly/quickrem.git
cd quickrem
mise install
mise exec -- just setup
mise exec -- just install
```

Log out and back in, then run just enable. Run just prefs to open preferences. After updating a loaded extension, start a new session to load its new code; opening preferences does not reload GNOME Shell.
<!-- quick-template:install:end -->

## Uninstall

<!-- quick-template:uninstall:start -->

Disable and uninstall the extension for your user. These commands preserve saved settings and other user data.

```sh
gnome-extensions disable quickrem@napalm255.github.io
gnome-extensions uninstall quickrem@napalm255.github.io
```

From a clone, just uninstall performs the same steps. Disabling with just disable leaves the extension installed.
<!-- quick-template:uninstall:end -->

## Testing

<!-- quick-template:testing:start -->

just test runs the JavaScript suite with Vitest, the shared tooling tests, and any project-specific offline suites. just coverage reports the JavaScript coverage universe, including untested runtime files. Test stubs and generated reports are not runtime source.

just test-docs runs Playwright and axe in Chromium and Firefox: dark and light accessibility checks, keyboard navigation, mobile layout, reduced motion, links, metadata, local assets, and no page JavaScript. Automated accessibility checks still require human review of reading and focus order.

just test-live checks the package and runs isolated GNOME lifecycle checks. It is a separate local check, not proof of compatibility from a hosted runner. Verify each declared GNOME version and complete the project's manual checks before releasing.
<!-- quick-template:testing:end -->

### Project checks

The offline suite verifies file-watcher coalescing, unsafe file types, argument-vector launching, preferences, and menu lifetimes. The isolated Shell check adds and removes profiles across enable/disable/re-enable. Use just fixtures 5 for throwaway profiles, then just fixtures-clean to remove them. Verify real Remmina launching manually.

## Packaging

<!-- quick-template:packaging:start -->

```sh
just build
just pack-check
```

The output is quickrem@napalm255.github.io.shell-extension.zip at the repository root, with metadata.json at the archive root. Python's standard library packages the explicit runtimeFiles allowlist in quick-project.json, using stable file order and timestamps.

just pack-check compares both filenames and file contents with GNOME's official packer and validates shipped icons. Docs, tests, dependencies, credentials, downloaded binaries, and development artifacts stay outside the ZIP. Update the runtime allowlist when adding a runtime file.
<!-- quick-template:packaging:end -->

## Releasing

<!-- quick-template:releasing:start -->

Run just ci, just test-live, and the project manual checklist. Set metadata.json version-name and package.json version to the same new version and increment metadata.json version for the GNOME Extension Store. Update the npm lockfile, regenerate the docs, and commit the reviewed changes to main through a passing pull request.

Create and push a v-prefixed tag for that version. The release workflow verifies the version, main ancestry, and successful required checks for the tagged commit, then attaches its tested ZIP to a GitHub release. It does not upload to extensions.gnome.org; that submission and its review remain manual.
<!-- quick-template:releasing:end -->

## Development

<!-- quick-template:development:start -->

mise.toml pins runtime and CLI versions; justfile owns commands; npm owns development dependencies and the lockfile. GNOME libraries come from the host. On image-based Fedora, use the host's available tools or a toolbox/distrobox for missing system packages; do not layer packages onto the OS.

```sh
just setup        # install pinned tools, dependencies, and browsers
just fmt          # format source and configuration
just lint         # verify template, generated docs, source, and schemas
just test         # JavaScript, Python, and project offline tests
just coverage     # report JavaScript coverage without source exclusions
just test-docs    # Chromium and Firefox documentation checks
just security     # dependencies, secrets, and workflow checks
just build        # build the runtime-only extension ZIP
just pack-check   # compare files and contents with GNOME's packer
just ci           # complete local verification and packaging
just test-live    # isolated GNOME lifecycle and project integration checks
just docs         # serve the static site at localhost:8000
just template-check  # verify the pinned canonical template
just template-status # report a newer approved template revision
```

GitHub requires local verification, security analysis, and completed Sonar analysis. The shared Sonar policy requires zero security, reliability, and maintainability issues and zero duplicated lines. Missing configuration fails instead of silently skipping analysis. Pages publishes the tested docs only after the required checks pass on main.

Common tooling and these instructions are generated from a pinned canonical template. Change that source and synchronize its approved revision; do not edit generated sections or locally bless drift. Extension-specific behavior belongs in project configuration and project.just.
<!-- quick-template:development:end -->

## License

GPL-3.0-or-later.
