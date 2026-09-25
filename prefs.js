// Preferences. Runs in its own process, with no access to gnome-shell's
// resource:// modules — so nothing here may import from modules/panel.js or
// modules/store.js.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// modules/detect.js and modules/io.js import only gi:// and modules that import
// nothing, so they are safe to pull into this process. Sharing the whole probe
// — not just the rules under it — is what stops the directory shown here from
// drifting away from the one the Shell actually reads.
import { detectProfileDir } from './modules/detect.js';
import { pathExists } from './modules/io.js';

/**
 * The second line of the status row: how the directory was chosen, and whether
 * it exists. Whole sentences, one per case, so a translator never has to make
 * two separately translated fragments agree with each other.
 *
 * A function rather than a module-level table because `_()` may only be called
 * once the extension is resolved and its gettext domain is bound. Building the
 * table at module load throws "gettext can only be called from extensions" and
 * the preferences window never opens at all.
 *
 * @param {string} source A source from detectProfileDir.
 * @param {boolean} exists Whether the directory exists.
 * @returns {string} How to describe it.
 */
function sourceLabel(source, exists) {
    switch (source) {
        case 'override':
            return exists ? _('set below') : _('set below — does not exist yet');
        case 'datadir':
            return exists
                ? _('from datadir_path in remmina.pref')
                : _('from datadir_path in remmina.pref — does not exist yet');
        case 'native':
            return exists
                ? _('detected from the native Remmina install')
                : _('detected from the native Remmina install — does not exist yet');
        case 'flatpak':
            return exists
                ? _('detected from the Flatpak install')
                : _('detected from the Flatpak install — does not exist yet');
        default:
            return source;
    }
}

/**
 * A row that says what the extension resolved to, so a mistyped override or a
 * missing Remmina is visible here rather than only as an empty menu.
 */
const StatusRow = GObject.registerClass(
    class QuickRemStatusRow extends Adw.ActionRow {
        /**
         * @param {Gio.Settings} settings Extension settings.
         */
        constructor(settings) {
            // Plain text, not markup. AdwPreferencesRow parses its title and
            // subtitle as Pango markup by default, and the subtitle holds a
            // path: one with & or < in it failed to parse and the row went
            // blank, hiding exactly the thing this row exists to show.
            super({ title: _('Profile directory'), use_markup: false });

            this._settings = settings;
            this._generation = 0;
            this.add_css_class('property');

            this._changedId = settings.connect('changed::profile-dir', () =>
                this.refresh(),
            );
            this.connect('destroy', () => this._settings.disconnect(this._changedId));

            // Deliberately not started here: a constructor cannot await, and a
            // promise left running from one is both unobservable and a smell.
            // fillPreferencesWindow calls refresh() once the row is built.
        }

        /**
         * Recompute the subtitle from the current settings.
         *
         * @returns {Promise<void>} Resolves once the subtitle is set. Returned
         *   so a test can await it; nothing in the UI needs to.
         */
        async refresh() {
            // The override is bound to an entry and changes on every
            // keystroke, so refreshes overlap; only the newest may write.
            const generation = ++this._generation;

            try {
                const { dir, source } = await detectProfileDir(
                    this._settings.get_string('profile-dir'),
                );
                const exists = dir ? await pathExists(dir) : false;
                if (generation !== this._generation) return;

                if (source === 'invalid') {
                    this.subtitle = _(
                        'The directory below must be an absolute path, or start with ~/.',
                    );
                } else if (!dir) {
                    this.subtitle = _(
                        'Remmina was not found. Install it, or set a directory below.',
                    );
                } else {
                    this.subtitle = `${dir}\n${sourceLabel(source, exists)}`;
                }
            } catch (error) {
                console.warn(`[quickrem] could not resolve the directory: ${error}`);
            }
        }
    },
);

export default class QuickRemPreferences extends ExtensionPreferences {
    /**
     * @param {Adw.PreferencesWindow} window Window to fill.
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const status = new Adw.PreferencesGroup({
            // A product name, so not marked for translation.
            title: 'Remmina',
            description: _(
                'QuickRem detects where Remmina keeps its profiles. Override either ' +
                    'setting only if detection gets it wrong.',
            ),
        });
        const statusRow = new StatusRow(settings);
        status.add(statusRow);
        page.add(status);

        // Started here rather than from the row's constructor, so the promise
        // has somewhere to belong.
        statusRow.refresh();

        const overrides = new Adw.PreferencesGroup({ title: _('Overrides') });

        // Written on every keystroke. The status row and the Shell's store
        // both cope with that: each keeps only its newest resolve, and the
        // store waits for the typing to stop before it starts one.
        const dir = new Adw.EntryRow({ title: _('Profile directory') });
        settings.bind('profile-dir', dir, 'text', Gio.SettingsBindFlags.DEFAULT);
        overrides.add(dir);

        const command = new Adw.EntryRow({ title: _('Launch command') });
        settings.bind('launch-command', command, 'text', Gio.SettingsBindFlags.DEFAULT);
        overrides.add(command);

        page.add(overrides);
        window.add(page);
    }
}
