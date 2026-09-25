// resource:///org/gnome/shell/extensions/extension.js, as far as modules/panel.js
// uses it.

/**
 * @param {string} text String to translate.
 * @returns {string} The same string.
 */
export const gettext = text => text;

/**
 * @param {string} singular Singular form.
 * @param {string} plural Plural form.
 * @param {number} count How many.
 * @returns {string} The form English would use.
 */
export const ngettext = (singular, plural, count) => (count === 1 ? singular : plural);

// gnome-shell installs String.prototype.format at startup (ui/environment.js),
// and modules/panel.js formats the ngettext result with it. Only %d and %s are
// modeled, which is all the panel uses.
if (!Object.hasOwn(String.prototype, 'format')) {
    Object.defineProperty(String.prototype, 'format', {
        value(...args) {
            let next = 0;
            return this.replace(/%[ds]/g, () => String(args[next++]));
        },
    });
}
