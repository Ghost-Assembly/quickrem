// resource:///org/gnome/shell/ui/main.js, as far as modules/panel.js uses it.

import { QuickSettingsMenu } from './shell-quicksettings.js';

/** The primary monitor's work area. Tests may change the height. */
export const workArea = { height: 1048 };

export const layoutManager = {
    primaryMonitor: { index: 0 },
    getWorkAreaForMonitor: () => ({ ...workArea }),
};

export const panel = {
    statusArea: {
        quickSettings: {
            menu: new QuickSettingsMenu(),

            /**
             * @param {object} indicator A SystemIndicator.
             */
            addExternalIndicator(indicator) {
                for (const item of indicator.quickSettingsItems)
                    this.menu.addItem(item);
            },
        },
    },
};

/** A fresh panel and screen. Call from beforeEach. */
export function reset() {
    workArea.height = 1048;
    panel.statusArea.quickSettings.menu = new QuickSettingsMenu();
}
