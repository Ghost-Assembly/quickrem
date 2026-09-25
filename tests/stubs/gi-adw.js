// Stand-in for gi://Adw, wired up by the aliases in vitest.config.js.
//
// Enough of the widget API for prefs.js to be imported and run. It records what
// was built rather than rendering anything, so a test can assert on the rows
// that came out.

class Widget {
    /**
     * @param {object} props Construct properties.
     */
    constructor(props = {}) {
        Object.assign(this, props);
        this.cssClasses = [];
        this.signals = [];
    }

    /**
     * @param {string} name Class to add.
     */
    add_css_class(name) {
        this.cssClasses.push(name);
    }

    /**
     * @param {string} signal Signal name.
     * @param {Function} callback Handler.
     * @returns {number} A handler id.
     */
    connect(signal, callback) {
        this.signals.push({ signal, callback });
        return this.signals.length;
    }

    /** Fire the widget's `destroy` handlers, as GTK would. */
    destroy() {
        for (const { signal, callback } of this.signals)
            if (signal === 'destroy') callback(this);
    }
}

class Container extends Widget {
    /**
     * @param {object} props Construct properties.
     */
    constructor(props = {}) {
        super(props);
        this.children = [];
    }

    /**
     * @param {object} child Child to add.
     */
    add(child) {
        this.children.push(child);
    }
}

/**
 * Whether Pango would reject a string as markup. Only what prefs.js can
 * produce is modeled: it never emits tags, so any `<` is an error, and an `&`
 * that does not start an entity is one too.
 */
const INVALID_MARKUP = /<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/**
 * AdwPreferencesRow, as far as its title and subtitle go. `use-markup`
 * defaults to true, as in libadwaita, and a string that fails to parse as
 * markup renders as nothing at all — with a Gtk-WARNING, confirmed against
 * libadwaita 1.9. Modeling that is what lets a test see a row go blank.
 */
class PreferencesRow extends Widget {
    constructor(props = {}) {
        super({ use_markup: true, ...props });
    }

    /**
     * @param {string} text A title or subtitle.
     * @returns {string} What the row would show for it.
     */
    _render(text) {
        return this.use_markup && INVALID_MARKUP.test(text ?? '') ? '' : (text ?? '');
    }

    /** @returns {string} The subtitle as it would appear on screen. */
    get renderedSubtitle() {
        return this._render(this.subtitle);
    }
}

export default {
    ActionRow: class ActionRow extends PreferencesRow {},
    EntryRow: class EntryRow extends PreferencesRow {},
    PreferencesGroup: class PreferencesGroup extends Container {},
    PreferencesPage: class PreferencesPage extends Container {},
    PreferencesWindow: class PreferencesWindow extends Container {},
};
