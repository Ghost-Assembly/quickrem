// The UI layer: the Quick Settings tile, its menu, and launching.
//
// The only file in QuickRem that touches St, Main or QuickSettings. It holds no
// profile state of its own — the store owns that, and this rebuilds on the
// store's `changed` signal.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { ensureActorVisibleInScrollView } from 'resource:///org/gnome/shell/misc/animationUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {
    gettext as _,
    ngettext,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import { launchProfile, launchRemmina } from './launch.js';
import { joinPath } from './paths.js';
import { profileDetail, protocolIcon } from './profiles.js';

/**
 * How much of the work area the profile list may take before it starts to
 * scroll. The rest has to hold the menu header, the separator and the two
 * footer items, and the quick settings panel is anchored under the top bar, so
 * the list cannot have the screen to itself.
 */
const LIST_MAX_HEIGHT_FRACTION = 0.5;

/** Floor for that, so a short screen still shows a usable number of rows. */
const LIST_MIN_HEIGHT = 200;

/**
 * The profile list, in a scroll view.
 *
 * QuickToggleMenu has no scrolling of its own — measured on a 1080p screen, 30
 * profiles want 1296px of a 1048px work area, and the surplus is simply clipped.
 * GNOME's own Wi-Fi menu answers this by showing only the first eight networks
 * and sending you to Settings for the rest, which suits a list you skim but not
 * one you pick from: the whole point here is that any saved connection is one
 * click away.
 *
 * So the list scrolls instead. PopupMenuSection is subclassed rather than
 * wrapped because PopupMenuBase.addMenuItem() adds `section.actor` to the menu
 * and does its bookkeeping against the section object; swapping the actor for a
 * scroll view around the same box keeps every bit of that — key navigation,
 * open-state propagation and activation — while changing what the menu holds.
 */
class ProfileSection extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        this.actor = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
            clip_to_allocation: true,
            child: this.box,
        });
        this.actor._delegate = this;
    }

    addMenuItem(menuItem, position) {
        super.addMenuItem(menuItem, position);

        // St.ScrollView does not follow keyboard focus on its own — measured
        // on a list of forty, focusing the twenty-sixth row left the scroll
        // position at zero — so arrowing past the visible rows moved the
        // selection off-screen. The Shell's own helper is what its other
        // scrolling lists use for this.
        //
        // The handler dies with the item, and every item is destroyed on the
        // next rebuild, so there is nothing here to disconnect by hand.
        menuItem.connect('key-focus-in', () =>
            ensureActorVisibleInScrollView(this.actor, menuItem),
        );
    }

    /**
     * Re-cap the list against the current screen and show the scrollbar only
     * when there is something to scroll.
     *
     * Called on a rebuild while the menu is open and just before every open,
     * which covers a monitor change or a text-scaling change without watching
     * for either.
     */
    updateHeight() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const max = Math.max(
            LIST_MIN_HEIGHT,
            Math.round(workArea.height * LIST_MAX_HEIGHT_FRACTION),
        );

        const [, natural] = this.box.get_preferred_height(-1);
        const scrolls = natural > max;

        // A max-height on the scroll view is what makes it scroll at all; St
        // otherwise gives it whatever its contents ask for. The min-height is
        // for the menu's open animation, which eases to the menu's *minimum*
        // height: a scroll view that may scroll reports a minimum of about
        // zero, and the menu opened to its header and footer and then jumped
        // to full height once the animation ended.
        this.actor.style = `max-height: ${max}px; min-height: ${Math.min(natural, max)}px;`;

        // AUTOMATIC always reserves width for a scrollbar, which looks wrong
        // when there is nothing to scroll, so it is turned on only when needed.
        this.actor.vscrollbar_policy = scrolls
            ? St.PolicyType.AUTOMATIC
            : St.PolicyType.NEVER;
    }
}

/**
 * Widest the profile name may render before it is ellipsized, and the same for
 * the dimmed detail beside it.
 *
 * Both come out of a file the extension does not control. Ellipsizing alone is
 * not enough — a ClutterText still asks for the full width of its text, and
 * measured with a 400-character name the menu ballooned to 4346px — so the
 * labels are clamped and the ellipsis then has something to bite on.
 */
const NAME_MAX_WIDTH = '15em';
const DETAIL_MAX_WIDTH = '10em';

/**
 * One profile in the list: protocol icon, name, and a dimmed `user@host`.
 */
const ProfileItem = GObject.registerClass(
    {
        GTypeName: 'QuickRemProfileItem',
    },
    class ProfileItem extends PopupMenu.PopupImageMenuItem {
        /**
         * @param {object} profile A profile from the store.
         */
        constructor(profile) {
            super(profile.name, protocolIcon(profile.protocol));

            this.label.x_expand = true;
            this.label.style = `max-width: ${NAME_MAX_WIDTH};`;
            this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const detail = profileDetail(profile);
            if (detail === '') return;

            const label = new St.Label({
                text: detail,
                style: `max-width: ${DETAIL_MAX_WIDTH};`,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            // Dimmed on the actor rather than through a style class: the
            // extension ships no stylesheet, so a class would style nothing.
            label.opacity = 160;

            this.add_child(label);
        }
    },
);

const RemminaToggle = GObject.registerClass(
    {
        GTypeName: 'QuickRemToggle',
    },
    class RemminaToggle extends QuickSettings.QuickMenuToggle {
        /**
         * @param {object} extension The Extension instance.
         * @param {object} store A ProfileStore.
         * @param {Gio.Settings} settings The extension's settings.
         * @param {Gio.Icon} gicon Icon for the tile and the menu header.
         */
        constructor(extension, store, settings, gicon) {
            super({
                // A product name, so not marked for translation.
                title: 'Remmina',
                gicon,
                // There is no boolean state to toggle — the tile is a way into
                // a list, not a switch — so the checked state is never used.
                toggleMode: false,
            });

            this._extension = extension;
            this._settings = settings;
            this._store = store;
            this._gicon = gicon;

            // With toggleMode off, the Shell leaves a body click to us: only
            // the arrow opens the menu by default. A tile that does nothing
            // when clicked in the middle reads as broken, so both open it.
            this.connectObject('clicked', () => this.menu.open(), this);

            this.menu.setHeader(gicon, 'Remmina');

            this._section = new ProfileSection();
            this.menu.addMenuItem(this._section);

            // The list is capped just before the menu opens, not in
            // open-state-changed: QuickToggleMenu.open() measures the height to
            // animate to and only then emits that signal, so a cap applied
            // there was always one open late. Measured in a headless Shell, the
            // first open animated to 1666px and settled at 710px. There is no
            // signal before the measurement and the class is not exported to
            // subclass, so the instance's open() is wrapped; it goes with the
            // menu when the menu is destroyed.
            const open = this.menu.open.bind(this.menu);
            this.menu.open = animate => {
                if (!this.menu.isOpen) this._section.updateHeight();
                open(animate);
            };

            // Opening the menu is the one moment someone is looking at "Remmina
            // not found", and a native install cannot be watched for: it lands
            // on PATH. So that is when detection runs again.
            this.menu.connectObject(
                'open-state-changed',
                (_menu, isOpen) => {
                    if (isOpen && this._store.source === 'none') this._store.reload();
                },
                this,
            );
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this.menu.addMenuItem(
                this._onActivate(new PopupMenu.PopupMenuItem(_('Open Remmina…')), () =>
                    launchRemmina(this._settings),
                ),
            );

            this.menu.addMenuItem(
                this._onActivate(new PopupMenu.PopupMenuItem(_('Settings')), () =>
                    this._extension.openPreferences(),
                ),
            );

            // `changed` covers the profiles and how the directory was chosen
            // — `source` is what tells an empty list apart from a missing
            // Remmina, and _emptyItem() switches on it — and fires once when
            // both move, so a resolve rebuilds the menu once rather than twice.
            store.connectObject('changed', () => this._rebuild(), this);

            this._rebuild();
        }

        /** Close the whole system menu, not just this tile's submenu. */
        _closePanel() {
            Main.panel.statusArea.quickSettings.menu.close();
        }

        /**
         * Wire an item so activating it closes the panel and does one thing.
         *
         * Every item in this menu wants that pair. connectObject() ties the
         * handler to both the item and this toggle, and the Shell's signal
         * tracker releases it when either is destroyed, so nothing here has
         * to disconnect it by hand.
         *
         * @param {object} item A menu item.
         * @param {Function} action What activating it should do.
         * @returns {object} The same item, for use as an argument.
         */
        _onActivate(item, action) {
            item.connectObject(
                'activate',
                () => {
                    this._closePanel();
                    action();
                },
                this,
            );

            return item;
        }

        /** Rebuild the profile list from the store. */
        _rebuild() {
            this._section.removeAll();

            const profiles = this._store.profiles;
            const subtitle =
                profiles.length > 0
                    ? ngettext('%d profile', '%d profiles', profiles.length).format(
                          profiles.length,
                      )
                    : '';

            this.subtitle = subtitle;
            this.menu.setHeader(this._gicon, 'Remmina', subtitle);

            if (profiles.length === 0) {
                this._section.addMenuItem(this._emptyItem());
            } else {
                for (const profile of profiles) {
                    this._section.addMenuItem(
                        this._onActivate(new ProfileItem(profile), () =>
                            launchProfile(profile, this._settings),
                        ),
                    );
                }
            }

            // updateHeight() measures every row, and the rebuild above has just
            // invalidated the box. While the menu is shut nobody can see the
            // result and open() measures again on the way in, so the work is
            // left to then. (PopupMenuSection.isOpen is hardcoded true, so the
            // real menu has to be the one asked.)
            if (this.menu.isOpen) this._section.updateHeight();
        }

        /**
         * @returns {PopupMenu.PopupMenuItem} An inert item saying why the list
         *   is empty: no Remmina at all, or a Remmina with nothing saved yet.
         */
        _emptyItem() {
            // Nothing found at all is something the user can act on, so that
            // item opens the preferences where the directory can be set. An
            // empty but valid directory is not — Open Remmina… below it is the
            // useful action — so that one stays inert.
            if (this._store.source === 'none') {
                return this._onActivate(
                    new PopupMenu.PopupMenuItem(_('Remmina not found')),
                    () => this._extension.openPreferences(),
                );
            }

            if (this._store.source === 'invalid') {
                return this._onActivate(
                    new PopupMenu.PopupMenuItem(
                        _('Profile directory setting is invalid'),
                    ),
                    () => this._extension.openPreferences(),
                );
            }

            // `reactive: false` already leaves the item unactivatable and gives
            // it the inactive style class, so setSensitive() would only re-set
            // what it already holds.
            return new PopupMenu.PopupMenuItem(_('No profiles saved'), {
                reactive: false,
                can_focus: false,
            });
        }

        destroy() {
            this.menu.disconnectObject(this);
            this._store?.disconnectObject(this);
            this._store = null;
            this._extension = null;
            this._settings = null;
            this._section = null;

            // The Shell never destroys a toggle's menu: QuickSettingsMenu
            // parents menu.actor into its own overlay and nothing in
            // quickSettings.js destroys it. Left alone, every disable — and
            // so every screen lock — leaked one menu with its rows and focus
            // group; measured, the overlay went from 14 children to 15 to 16.
            this.menu.destroy();

            super.destroy();
        }
    },
);

export const RemminaIndicator = GObject.registerClass(
    {
        GTypeName: 'QuickRemIndicator',
    },
    class RemminaIndicator extends QuickSettings.SystemIndicator {
        /**
         * @param {object} extension The Extension instance.
         * @param {object} store A ProfileStore.
         * @param {Gio.Settings} settings The extension's settings.
         */
        constructor(extension, store, settings) {
            super();

            // No _addIndicator(): Remmina is not a status, and a permanent top
            // bar icon that never changes is noise. The tile is the whole UI.
            const gicon = Gio.icon_new_for_string(
                joinPath(extension.path, 'icons/quickrem-symbolic.svg'),
            );

            this.quickSettingsItems.push(
                new RemminaToggle(extension, store, settings, gicon),
            );
        }

        destroy() {
            this.quickSettingsItems.forEach(item => item.destroy());
            this.quickSettingsItems.length = 0;

            super.destroy();
        }
    },
);
