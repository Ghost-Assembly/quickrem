import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlers, launches, makeHandler, reset as resetGio } from './stubs/gi-gio.js';
import { SignalEmitter } from './stubs/gi-gobject.js';
import St from './stubs/gi-st.js';
import { scrolls } from './stubs/shell-animation-utils.js';
import { panel, reset as resetMain, workArea } from './stubs/shell-main.js';
import { FakeSettings } from './stubs/settings.js';
import { RemminaIndicator } from '../modules/panel.js';

/** Stands in for modules/store.js: what the panel reads, and its one signal. */
class FakeStore extends SignalEmitter {
    constructor({ profiles = [], source = 'flatpak' } = {}) {
        super();
        this.profiles = profiles;
        this.source = source;
        this.reload = vi.fn();
    }

    /**
     * @param {object} state New profiles and source.
     */
    publish(state) {
        Object.assign(this, state);
        this.emit('changed');
    }
}

const extension = {
    path: '/ext',
    openPreferences: vi.fn(),
};

/**
 * @param {number} count How many profiles.
 * @returns {Array<object>} That many profiles, sorted by name.
 */
function profiles(count) {
    return Array.from({ length: count }, (_, i) => ({
        name: `Profile ${String(i).padStart(2, '0')}`,
        protocol: 'SSH',
        server: `host${i}.example.com`,
        username: 'tester',
        path: `/profiles/p${i}.remmina`,
    }));
}

/**
 * Enable the panel side of the extension the way extension.js does.
 *
 * @param {FakeStore} store The store to render.
 * @returns {{indicator: object, toggle: object}} What was built.
 */
function enable(store) {
    const indicator = new RemminaIndicator(extension, store, new FakeSettings());
    panel.statusArea.quickSettings.addExternalIndicator(indicator);

    return { indicator, toggle: indicator.quickSettingsItems[0] };
}

/**
 * @param {object} toggle The tile.
 * @returns {object} The profile section, which is the menu's first item.
 */
const sectionOf = toggle => toggle.menu.items[0];

/**
 * @param {object} toggle The tile.
 * @returns {Array<string>} Labels of the rows in the profile list.
 */
const rowsOf = toggle => sectionOf(toggle).items.map(item => item.label.text);

const overlay = () => panel.statusArea.quickSettings.menu._overlay;

beforeEach(() => {
    resetGio();
    resetMain();
    scrolls.length = 0;
    extension.openPreferences.mockClear();
});

describe('disable', () => {
    it('destroys the menu the Shell leaves in its overlay', () => {
        // The Shell parents each toggle's menu into the quick settings overlay
        // and never destroys it, so every disable — every screen lock — used
        // to leave one menu behind.
        const store = new FakeStore({ profiles: profiles(3) });
        const baseline = overlay().get_n_children();

        for (let cycle = 0; cycle < 3; cycle++) {
            const { indicator } = enable(store);
            expect(overlay().get_n_children()).toBe(baseline + 1);

            indicator.destroy();
            expect(overlay().get_n_children()).toBe(baseline);
        }
    });

    it('lets go of every handler it put on the store and the menu', () => {
        const store = new FakeStore();
        const { indicator, toggle } = enable(store);
        const menu = toggle.menu;
        expect(store.handlerCount).toBeGreaterThan(0);

        indicator.destroy();

        expect(store.handlerCount).toBe(0);
        // Only the Shell's own handler, which it never disconnects, remains.
        expect(menu.handlerCount).toBe(1);
    });
});

describe('opening the menu', () => {
    it('animates straight to the height it settles at, first time and after', () => {
        // QuickToggleMenu.open() measures its target before it emits
        // open-state-changed. Capped from that signal, the first open eased
        // to the uncapped list and every later one to the header alone.
        const { toggle } = enable(new FakeStore({ profiles: profiles(40) }));

        toggle.menu.open();
        toggle.menu.close();
        toggle.menu.open();

        const settled = toggle.menu.settledHeight();
        expect(toggle.menu.animationTargets).toEqual([settled, settled]);
    });

    it('caps a long list at half the work area and lets it scroll', () => {
        const { toggle } = enable(new FakeStore({ profiles: profiles(40) }));

        toggle.menu.open();

        const scrollView = sectionOf(toggle).actor;
        expect(scrollView.get_preferred_height(-1)).toEqual([524, 524]);
        expect(scrollView.vscrollbar_policy).toBe(St.PolicyType.AUTOMATIC);
    });

    it('leaves a short list its own height, with no scrollbar', () => {
        const { toggle } = enable(new FakeStore({ profiles: profiles(3) }));

        toggle.menu.open();

        const scrollView = sectionOf(toggle).actor;
        expect(scrollView.get_preferred_height(-1)).toEqual([3 * 37, 3 * 37]);
        expect(scrollView.vscrollbar_policy).toBe(St.PolicyType.NEVER);
        expect(toggle.menu.animationTargets).toEqual([toggle.menu.settledHeight()]);
    });

    it('re-measures on open, so a different screen is picked up', () => {
        const { toggle } = enable(new FakeStore({ profiles: profiles(40) }));
        toggle.menu.open();
        toggle.menu.close();

        workArea.height = 600;
        toggle.menu.open();

        expect(sectionOf(toggle).actor.get_preferred_height(-1)).toEqual([300, 300]);
        expect(toggle.menu.animationTargets.at(-1)).toBe(toggle.menu.settledHeight());
    });

    it('re-caps a list that changes while the menu is open', () => {
        const store = new FakeStore({ profiles: profiles(2) });
        const { toggle } = enable(store);
        toggle.menu.open();

        store.publish({ profiles: profiles(40) });

        expect(sectionOf(toggle).actor.get_preferred_height(-1)).toEqual([524, 524]);
    });

    it('opens from a click on the body of the tile', () => {
        const { toggle } = enable(new FakeStore());

        toggle.click();

        expect(toggle.menu.isOpen).toBe(true);
    });

    it('looks for Remmina again when it was not found', () => {
        // A native install lands on PATH, which cannot be watched; opening
        // the menu is when someone is looking at "Remmina not found".
        const store = new FakeStore({ source: 'none' });
        const { toggle } = enable(store);

        toggle.menu.open();

        expect(store.reload).toHaveBeenCalledTimes(1);
    });

    it('does not re-detect when Remmina was found', () => {
        const store = new FakeStore({ source: 'flatpak' });
        const { toggle } = enable(store);

        toggle.menu.open();

        expect(store.reload).not.toHaveBeenCalled();
    });
});

describe('the profile list', () => {
    it('shows every profile with who connects where', () => {
        const { toggle } = enable(new FakeStore({ profiles: profiles(2) }));

        expect(rowsOf(toggle)).toEqual(['Profile 00', 'Profile 01']);
        expect(toggle.subtitle).toBe('2 profiles');
        expect(sectionOf(toggle).items[0].children.at(-1).text).toBe(
            'tester@host0.example.com',
        );
    });

    it('rebuilds on the store changed signal only', () => {
        // The store emits `changed` once per resolve. Rebuilding on the
        // property notifications as well rebuilt the menu twice.
        const store = new FakeStore({ profiles: profiles(1) });
        const { toggle } = enable(store);
        const before = sectionOf(toggle).items[0];

        store.profiles = profiles(2);
        store.notify('profiles');
        store.notify('source');
        expect(sectionOf(toggle).items[0]).toBe(before);

        store.emit('changed');
        expect(rowsOf(toggle)).toEqual(['Profile 00', 'Profile 01']);
    });

    it('launches a profile and closes the panel', () => {
        handlers.set('application/x-remmina', makeHandler('remmina-file'));
        const { toggle } = enable(new FakeStore({ profiles: profiles(1) }));

        sectionOf(toggle).items[0].activate();

        expect(launches[0].uris).toEqual(['file:///profiles/p0.remmina']);
        expect(panel.statusArea.quickSettings.menu.closed).toBe(1);
    });

    it('keeps a focused row in view with the Shell helper', () => {
        const { toggle } = enable(new FakeStore({ profiles: profiles(40) }));
        const row = sectionOf(toggle).items[30];

        row.grab_key_focus();

        expect(scrolls).toEqual([{ scrollView: sectionOf(toggle).actor, actor: row }]);
    });
});

describe('an empty list', () => {
    it('says Remmina was not found, and opens the preferences', () => {
        const { toggle } = enable(new FakeStore({ source: 'none' }));

        expect(rowsOf(toggle)).toEqual(['Remmina not found']);
        sectionOf(toggle).items[0].activate();
        expect(extension.openPreferences).toHaveBeenCalledTimes(1);
    });

    it('says the directory setting is invalid, and opens the preferences', () => {
        const { toggle } = enable(new FakeStore({ source: 'invalid' }));

        expect(rowsOf(toggle)).toEqual(['Profile directory setting is invalid']);
        sectionOf(toggle).items[0].activate();
        expect(extension.openPreferences).toHaveBeenCalledTimes(1);
    });

    it('says nothing is saved when Remmina is there', () => {
        const { toggle } = enable(new FakeStore({ source: 'flatpak' }));

        expect(rowsOf(toggle)).toEqual(['No profiles saved']);
        expect(sectionOf(toggle).items[0].reactive).toBe(false);
    });

    it('updates when only the source changes', () => {
        const store = new FakeStore({ source: 'none' });
        const { toggle } = enable(store);

        store.publish({ source: 'flatpak' });

        expect(rowsOf(toggle)).toEqual(['No profiles saved']);
    });
});
