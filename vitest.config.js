import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const stub = name =>
    fileURLToPath(new URL(`./tests/stubs/${name}.js`, import.meta.url));

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            // Everything that holds a decision. modules/profiles.js,
            // modules/paths.js and modules/keyfile.js import nothing and run
            // as they ship; modules/store.js runs against the Gio stub below,
            // which is what makes the debounce, the generation counters and
            // the watch re-attach reachable from a unit test at all. prefs.js
            // is here because it decides something too — which directory to
            // report — and because a module-level gettext call there stops the
            // preferences window opening at all, silently.
            //
            // modules/panel.js is here as well. It was once left to
            // scripts/headless-check.sh on the grounds that stubs of the
            // toolkit only test the stubs, and in that time it leaked its menu
            // on every disable and animated the menu open to the wrong height
            // — neither of which a log-watching smoke test can see. The stubs
            // it runs against now model the two Shell behaviors it got wrong,
            // and say so where they do.
            //
            // extension.js is left out: it only pairs construction with
            // teardown, and the headless check enables, disables and
            // re-enables it in a real gnome-shell. That matches
            // sonar.coverage.exclusions in sonar-project.properties.
            include: ['modules/**/*.js', 'prefs.js'],
            // tests/stubs/* get pulled in through the aliases below, so they
            // are named here; a stub's own coverage means nothing.
            exclude: ['tests/**'],
        },
    },

    // gnome-shell resolves these at runtime; Node cannot. The stubs live in
    // tests/, so they are never shipped and never counted as covered code.
    resolve: {
        alias: [
            { find: 'gi://Gio', replacement: stub('gi-gio') },
            { find: 'gi://GLib', replacement: stub('gi-glib') },
            { find: 'gi://GObject', replacement: stub('gi-gobject') },
            { find: 'gi://Adw', replacement: stub('gi-adw') },
            { find: 'gi://Shell', replacement: stub('gi-shell') },
            { find: 'gi://Clutter', replacement: stub('gi-clutter') },
            { find: 'gi://Pango', replacement: stub('gi-pango') },
            { find: 'gi://St', replacement: stub('gi-st') },
            {
                find: 'resource:///org/gnome/shell/misc/animationUtils.js',
                replacement: stub('shell-animation-utils'),
            },
            {
                find: 'resource:///org/gnome/shell/ui/main.js',
                replacement: stub('shell-main'),
            },
            {
                find: 'resource:///org/gnome/shell/ui/popupMenu.js',
                replacement: stub('shell-popupmenu'),
            },
            {
                find: 'resource:///org/gnome/shell/ui/quickSettings.js',
                replacement: stub('shell-quicksettings'),
            },
            {
                find: 'resource:///org/gnome/shell/extensions/extension.js',
                replacement: stub('shell-extension'),
            },
            {
                find: 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js',
                replacement: stub('shell-prefs'),
            },
        ],
    },
});
