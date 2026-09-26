// resource:///org/gnome/shell/extensions/extension.js, as far as extension.js
// uses it.

export class Extension {
    /**
     * @param {object} [metadata] Contents of metadata.json.
     */
    constructor(metadata = { 'version-name': '0.0.0' }) {
        this.metadata = metadata;

        // The real base class resolves and caches a Gio.Settings from the
        // gschema. Tests set `settings` on the instance instead, so
        // extension.js can be driven without a schema or a live Shell.
        this.settings = null;

        // The real one is the extension's install directory. A test asserts
        // on paths built from it rather than on a file that has to exist.
        this.path = '/nonexistent/extension';

        /** Every openPreferences call, so a test can count them. */
        this.preferencesOpened = 0;
    }

    /**
     * @returns {object} Whatever the test assigned to `settings`.
     */
    getSettings() {
        return this.settings;
    }

    /** Open the preferences window. Recorded rather than performed. */
    openPreferences() {
        this.preferencesOpened += 1;
    }
}

// The Shell binds these to the extension's own gettext domain. The stub keeps
// them identity-like so a test reads the untranslated string it wrote.
export const gettext = message => message;
export const ngettext = (singular, plural, count) => (count === 1 ? singular : plural);
export const pgettext = (_context, message) => message;

// gnome-shell installs String.prototype.format at startup (ui/environment.js),
// and extensions format ngettext results with it. Only %d and %s are modeled.
if (!Object.hasOwn(String.prototype, 'format')) {
    Object.defineProperty(String.prototype, 'format', {
        value(...args) {
            let next = 0;
            return this.replace(/%[ds]/g, () => String(args[next++]));
        },
    });
}
