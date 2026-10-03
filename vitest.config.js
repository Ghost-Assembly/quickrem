import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const stub = name =>
    fileURLToPath(new URL(`./tests/stubs/${name}.js`, import.meta.url));

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: [
                'modules/**/*.js',
                'extension.js',
                'prefs.js',
                'scripts/soloist-runner.js',
            ],
            exclude: ['tests/**'],
        },
    },

    // GNOME imports resolve to recording stubs for offline behavior tests.
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
