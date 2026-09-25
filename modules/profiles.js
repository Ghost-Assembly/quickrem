// Profile parsing: the text of a .remmina file in, a plain object out.
//
// This file imports nothing — not `gi://`, not `resource:///` — for two
// reasons. It has to be loadable from the preferences process, which has no
// access to gnome-shell's `resource://` modules, and it has to be loadable by
// Vitest on plain Node so the parser can be pinned by tests rather than by
// hand-checking it against a live Shell.
//
// Remmina writes GKeyFile; modules/keyfile.js reads it, and is shared with the
// remmina.pref reader in modules/paths.js so there is one reader, not two.

// paths.js and keyfile.js import nothing either, so taking the suffix and the
// reader from them keeps this module loadable by Vitest and by the preferences
// process while leaving one definition of each.
import { readGroup } from './keyfile.js';
import { PROFILE_SUFFIX } from './paths.js';

/** The one section header a .remmina file has. */
const SECTION = 'remmina';

/**
 * Keys whose values are ciphertext: base64 of a 3DES blob encrypted with the
 * `secret=` in remmina.pref. Nothing in this extension can decrypt them and
 * nothing should try, so they are dropped while parsing rather than filtered
 * afterwards — a later code path that forgets to filter then has nothing to
 * leak into a menu label or a log line.
 */
const SECRET_KEY = /password|passphrase|secret/i;

/**
 * Icon for a protocol, by the `protocol=` values Remmina's bundled plugins use.
 * A Map rather than an object literal so a protocol read from a file is never
 * used as an object key.
 */
const PROTOCOL_ICONS = new Map([
    ['SSH', 'utilities-terminal-symbolic'],
    ['SFTP', 'folder-remote-symbolic'],
    ['RDP', 'preferences-desktop-remote-desktop-symbolic'],
    ['VNC', 'preferences-desktop-remote-desktop-symbolic'],
    ['GVNC', 'preferences-desktop-remote-desktop-symbolic'],
    ['SPICE', 'preferences-desktop-remote-desktop-symbolic'],
    ['WWW', 'web-browser-symbolic'],
    ['EXEC', 'system-run-symbolic'],
]);

/** Shown when the protocol is unknown, missing, or from a plugin we have no icon for. */
const FALLBACK_ICON = 'network-server-symbolic';

/**
 * The profile name to fall back on when the file has no usable `name=`.
 *
 * Remmina's own default filename template is `%G_%P_%N_%h.remmina`, so the stem
 * is at worst a recognizable description of the connection.
 *
 * @param {string} path Absolute path to the .remmina file.
 * @returns {string} The filename with its directory and .remmina suffix removed.
 */
function stemOf(path) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    return base.endsWith(PROFILE_SUFFIX) ? base.slice(0, -PROFILE_SUFFIX.length) : base;
}

/**
 * Parse one .remmina file.
 *
 * @param {string} text Contents of the file.
 * @param {string} path Absolute path it was read from.
 * @returns {{name: string, protocol: string, server: string, username: string,
 *   path: string}} The profile. Only what the menu shows or the launcher needs
 *   is kept; Remmina's `group=` is not, because nothing here displays it.
 */
export function parseProfile(text, path) {
    // Encrypted keys are rejected by the reader itself, so they never reach
    // the Map, let alone the returned object.
    const fields = readGroup(text, SECTION, key => !SECRET_KEY.test(key));
    const name = (fields.get('name') ?? '').trim();

    return {
        name: name === '' ? stemOf(path) : name,
        protocol: (fields.get('protocol') ?? '').trim().toUpperCase(),
        server: (fields.get('server') ?? '').trim(),
        username: (fields.get('username') ?? '').trim(),
        path,
    };
}

/**
 * Order profiles for display: by name, the way the user's locale collates.
 *
 * @param {Array<object>} profiles Profiles to order.
 * @returns {Array<object>} A new array, sorted. The input is left alone.
 */
export function sortProfiles(profiles) {
    return [...profiles].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Whether two profiles describe the same connection.
 *
 * Fields are compared by name rather than by iterating keys, so a value read
 * out of a file is never used as an object key.
 *
 * @param {object} a A profile.
 * @param {object} b Another profile.
 * @returns {boolean} Whether every field matches.
 */
function sameProfile(a, b) {
    return (
        a.path === b.path &&
        a.name === b.name &&
        a.protocol === b.protocol &&
        a.server === b.server &&
        a.username === b.username
    );
}

/**
 * Whether two sorted profile lists are identical.
 *
 * The store rescans on any event in the watched directory, and when the profile
 * directory does not exist yet that watch sits on an ancestor which other
 * programs write to constantly. Without this the menu would be torn down and
 * rebuilt for each of those, losing hover and keyboard focus under the pointer.
 *
 * @param {Array<object>} a A sorted profile list.
 * @param {Array<object>} b Another sorted profile list.
 * @returns {boolean} Whether they hold the same profiles in the same order.
 */
export function sameProfiles(a, b) {
    if (a.length !== b.length) return false;

    // Indexed with at() rather than [i]: a bracket lookup on a value that came
    // out of a file is the shape eslint-plugin-security flags, and avoiding it
    // costs nothing here.
    return a.every((profile, i) => sameProfile(profile, b.at(i)));
}

/**
 * Secondary text for a profile: who connects where.
 *
 * Two profiles both called "prod" are otherwise indistinguishable in the menu,
 * and the store already reads these fields.
 *
 * @param {object} profile A parsed profile.
 * @returns {string} `user@host`, or the host alone, or '' when there is no host.
 */
export function profileDetail({ username, server }) {
    if (!server) return '';

    return username ? `${username}@${server}` : server;
}

/**
 * Symbolic icon name for a profile's protocol.
 *
 * @param {string} protocol The `protocol=` value, in any case.
 * @returns {string} A symbolic icon name that is always in the stock theme.
 */
export function protocolIcon(protocol) {
    if (typeof protocol !== 'string') return FALLBACK_ICON;

    return PROTOCOL_ICONS.get(protocol.trim().toUpperCase()) ?? FALLBACK_ICON;
}
