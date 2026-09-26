import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reset as resetGio } from './stubs/gi-gio.js';
import { FakeSettings } from './stubs/settings.js';
import { panel, reset as resetMain } from './stubs/shell-main.js';

import QuickRemExtension from '../extension.js';

/*
 * extension.js has no logic of its own beyond pairing construction with
 * teardown: one Gio.Settings, handed to both the store and the indicator, and
 * a fixed order on the way down (see disable() there for why). Everything
 * modules/panel.js and modules/store.js do with that settings object already
 * has its own suite, so this one only proves the wiring and the teardown.
 */

/**
 * @param {object} [metadata] Contents of metadata.json.
 * @returns {QuickRemExtension} A fresh extension, with settings already
 *   resolved the way getSettings() would.
 */
function build(metadata) {
    const extension = new QuickRemExtension(metadata);
    extension.settings = new FakeSettings();
    return extension;
}

/** @returns {object} The quick settings grid, so a test can count tiles. */
const grid = () => panel.statusArea.quickSettings.menu._grid;

beforeEach(() => {
    resetGio();
    resetMain();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('QuickRemExtension', () => {
    it('puts a tile in quick settings when enabled', () => {
        const extension = build();

        extension.enable();

        expect(grid().get_n_children()).toBe(1);
        extension.disable();
    });

    // scripts/headless-check.sh greps for this line, so the prefix is a
    // contract with that script rather than a nicety.
    it('logs the marker the headless check greps for', () => {
        const extension = build({ 'version-name': '9.9.9' });

        extension.enable();

        expect(console.debug).toHaveBeenCalledWith('[quickrem] enabled (v9.9.9)');
        extension.disable();
    });

    it('survives metadata with no version', () => {
        const extension = build({});

        extension.enable();

        expect(console.debug).toHaveBeenCalledWith('[quickrem] enabled (v?)');
        extension.disable();
    });

    it('tolerates disable without enable, and twice', () => {
        const extension = build();

        expect(() => extension.disable()).not.toThrow();
        extension.enable();
        extension.disable();
        expect(() => extension.disable()).not.toThrow();
    });

    // The shape scripts/headless-check.sh exercises against a real Shell.
    it('can be enabled, disabled and enabled again', () => {
        const extension = build();

        extension.enable();
        extension.disable();
        extension.enable();

        // Back to one, not two: the first disable must have let go of the
        // tile it put in the grid, or a re-enable would leak one per cycle.
        expect(grid().get_n_children()).toBe(1);
        extension.disable();
    });

    it('drops every reference on disable', () => {
        const extension = build();

        extension.enable();
        extension.disable();

        expect(extension._indicator).toBeNull();
        expect(extension._store).toBeNull();
    });
});
