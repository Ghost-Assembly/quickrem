// resource:///org/gnome/shell/ui/quickSettings.js, as far as modules/panel.js
// uses it. Two behaviors of the real one are modeled on purpose, because the
// panel got both wrong:
//
// - QuickToggleMenu.open() measures the height it will animate to — the
//   menu's *minimum* height — and only then emits open-state-changed.
// - QuickSettingsMenu parents each toggle's menu.actor into its overlay, and
//   nothing ever destroys the menu: not the toggle's destroy, not the panel.

import { FakeActor } from '../support/actors.js';
import { PopupMenuBase } from './shell-popupmenu.js';

class QuickToggleMenu extends PopupMenuBase {
    constructor(sourceActor) {
        super();
        this.sourceActor = sourceActor;
        this.header = { icon: null, title: '', subtitle: '' };

        // The header row, measured at 55px in Shell 50.3, then the items.
        this.actor = new FakeActor();
        this.actor.add_child(new FakeActor({ rowHeight: 55 }));
        this.actor.add_child(this.box);

        // Every height the open animation eased to, in order.
        this.animationTargets = [];
    }

    setHeader(icon, title, subtitle = '') {
        this.header = { icon, title, subtitle };
    }

    /** As Shell 50.3: measure, start the animation, then emit. */
    open() {
        if (this.isOpen) return;

        this.actor.show();
        this.isOpen = true;

        const [targetHeight] = this.actor.get_preferred_height(-1);
        this.animationTargets.push(targetHeight);

        this.emit('open-state-changed', true);
    }

    /** @returns {number} The height the menu settles at once open. */
    settledHeight() {
        return this.actor.get_preferred_height(-1)[1];
    }
}

class QuickMenuToggle extends FakeActor {
    constructor(params = {}) {
        super(params);
        this.menu = new QuickToggleMenu(this);
        this.menu.actor.hide();
        // Deliberately NOT destroyed with the toggle. The real
        // QuickSettingsItem never destroys its menu — Shell 50.3's
        // quickSettings.js has no destroy call at all — so an extension that
        // does not destroy it leaks one menu per disable.
    }

    /** Fire the tile as a click on its body would. */
    click() {
        this.emit('clicked', this);
    }
}

class SystemIndicator extends FakeActor {
    constructor(params = {}) {
        super(params);
        this.quickSettingsItems = [];
    }
}

/** The quick settings panel's menu, with its grid and its overlay. */
class QuickSettingsMenu {
    constructor() {
        this._grid = new FakeActor();
        this._overlay = new FakeActor();
        this.closed = 0;
    }

    /**
     * As _completeAddItem: the item into the grid, its menu's actor into the
     * overlay, and a handler on the menu that is never disconnected.
     *
     * @param {object} item A quick settings item.
     */
    addItem(item) {
        this._grid.add_child(item);
        if (!item.menu) return;

        this._overlay.add_child(item.menu.actor);
        item.menu.connect('open-state-changed', () => {});
    }

    close() {
        this.closed++;
    }
}

export { QuickMenuToggle, QuickSettingsMenu, QuickToggleMenu, SystemIndicator };
