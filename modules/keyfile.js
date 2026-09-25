// A reader for the one kind of file Remmina writes: GKeyFile.
//
// Imports nothing, like modules/profiles.js and modules/paths.js, which both
// use it — the .remmina parser and the remmina.pref reader used to carry a
// hand-rolled copy each, and the two copies had already drifted: one matched
// its key by prefix and ignored sections and escapes.
//
// GLib.KeyFile would be the more complete reader. What Remmina emits is flat
// `key=value` lines under `[group]` headers, which is small enough to read
// here, and keeping `gi://GLib` out of the modules most worth testing
// exhaustively is worth the trade. Where this does differ from GKeyFile it is
// stricter, never looser: a key matches exactly or not at all.

/** GKeyFile value escapes. */
const ESCAPES = new Map([
    [String.raw`\n`, '\n'],
    [String.raw`\t`, '\t'],
    [String.raw`\r`, '\r'],
    [String.raw`\s`, ' '],
    [String.raw`\\`, '\\'],
]);

/**
 * Undo the escapes GKeyFile writes into values.
 *
 * One pass over the string, so `\\s` is a backslash followed by `s` rather
 * than a backslash followed by a space — the order-dependent bug a chain of
 * replace() calls would have.
 *
 * @param {string} value Raw value, leading whitespace already removed.
 * @returns {string} The value with escape sequences resolved.
 */
function unescapeValue(value) {
    return value.replace(/\\[ntrs\\]/g, match => ESCAPES.get(match) ?? match);
}

/**
 * Read one group of a key file into a Map.
 *
 * As GKeyFile does: lines are trimmed; `#` starts a comment (`;` is accepted
 * too, since a hand-edited file might use it and neither is ever a key); a key
 * is everything before the first `=`, trimmed, and is compared exactly; the
 * value is everything after it with leading whitespace removed and escapes
 * resolved; a group that appears twice is merged, and a later key replaces an
 * earlier one.
 *
 * @param {string} text Contents of the file.
 * @param {string} group Group to read, without the brackets.
 * @param {Function} keep Called with each key; only keys it accepts are read.
 *   A key it rejects is never unescaped or stored, which is how a caller keeps
 *   a secret out of the result rather than filtering it afterwards.
 * @returns {Map<string, string>} Keys to values.
 */
export function readGroup(text, group, keep) {
    const fields = new Map();
    if (typeof text !== 'string') return fields;

    const header = `[${group}]`;
    let inGroup = false;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();

        if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;

        if (line.startsWith('[')) {
            inGroup = line === header;
            continue;
        }

        if (!inGroup) continue;

        // Split on the FIRST `=` only. Values routinely contain `=` — base64
        // padding and RDP option strings both do — and splitting on all of
        // them truncates the value silently.
        const eq = line.indexOf('=');
        if (eq < 1) continue;

        const key = line.slice(0, eq).trim();
        if (!keep(key)) continue;

        fields.set(key, unescapeValue(line.slice(eq + 1).trimStart()));
    }

    return fields;
}
