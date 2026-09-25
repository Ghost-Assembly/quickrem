// resource:///org/gnome/shell/ui/popupMenu.js, as far as modules/panel.js uses it.
//
// The menu classes keep real child bookkeeping, so tests/panel.test.js can
// count the rows QuickRem built and fire the ones it cares about. Row heights
// are the ones measured in a headless Shell 50.3.

import { SignalEmitter } from './gi-gobject.js';
import { FakeActor } from '../support/actors.js';

/** A menu row. PopupMenuItem measured 37px in Shell 50.3, the separator 19px. */
class PopupBaseMenuItem extends FakeActor {
    constructor(params = {}) {
        super({ rowHeight: 37, can_focus: true, ...params });
    }

    /** Fire the item as a click would. */
    activate() {
        this.emit('activate', this);
    }

    /** Give it keyboard focus, as arrowing onto it would. */
    grab_key_focus() {
        this.emit('key-focus-in');
    }
}

/** @returns {FakeActor} A label with the clutter_text the real one exposes. */
function makeLabel(text) {
    const label = new FakeActor({ text });
    label.clutter_text = { ellipsize: null };
    return label;
}

class PopupMenuItem extends PopupBaseMenuItem {
    constructor(text, params = {}) {
        super(params);
        this.label = makeLabel(text);
        this.add_child(this.label);
    }
}

class PopupImageMenuItem extends PopupMenuItem {
    constructor(text, icon, params = {}) {
        super(text, params);
        this.icon = icon;
    }
}

class PopupSeparatorMenuItem extends PopupBaseMenuItem {
    constructor() {
        super({ rowHeight: 19, can_focus: false });
    }
}

/**
 * PopupMenuBase is a Signals.EventEmitter, not an actor, with
 * connectObject/disconnectObject added by the Shell's signal tracker.
 */
class PopupMenuBase extends SignalEmitter {
    constructor() {
        super();
        this.box = new FakeActor();
        this.isOpen = false;
        this._items = [];
    }

    /**
     * @param {object} item A menu item or a section.
     */
    addMenuItem(item) {
        // A section's actor is what goes into the box, as in the real
        // addMenuItem, which is what lets ProfileSection swap it.
        this.box.add_child(item instanceof PopupMenuSection ? item.actor : item);
        this._items.push(item);
    }

    /** Destroy every item, as the real removeAll does. */
    removeAll() {
        for (const item of this._items) item.destroy();
        this._items = [];
    }

    /** @returns {Array<object>} The items, for a test to inspect. */
    get items() {
        return [...this._items];
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.emit('open-state-changed', false);
    }

    /** As the real one: close, destroy the items and the actor, then emit. */
    destroy() {
        this.close();
        this.removeAll();
        this.actor.destroy();
        this.emit('destroy');
    }
}

class PopupMenuSection extends PopupMenuBase {
    constructor() {
        super();
        this.actor = this.box;
        this.actor._delegate = this;
        // Hardcoded, as in the real class: a section is always "open".
        this.isOpen = true;
    }

    open() {
        this.emit('open-state-changed', true);
    }

    close() {
        this.emit('open-state-changed', false);
    }
}

export {
    PopupBaseMenuItem,
    PopupImageMenuItem,
    PopupMenuBase,
    PopupMenuItem,
    PopupMenuSection,
    PopupSeparatorMenuItem,
};
