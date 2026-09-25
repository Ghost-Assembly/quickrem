// The file I/O the rest of QuickRem does, all of it asynchronous.
//
// These run in the gnome-shell process, on the compositor thread. A profile
// directory, a remmina.pref and even a PATH entry can live on a network-mounted
// home, and a synchronous call there stalls the whole desktop, not just this
// menu. So every call here hands the work to GIO's thread pool and awaits it.
//
// Gio._promisify is idempotent: it records the original method under
// `_original_<name>` and returns early when that is already there, so calling
// it again for a method another extension already wrapped changes nothing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { joinPath } from './paths.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'read_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');

/** Stateless for these calls, so one is reused rather than one per read. */
const DECODER = new TextDecoder();

/**
 * Largest file worth reading. A .remmina file or a remmina.pref is a few
 * hundred bytes, so this is three orders of magnitude of headroom. It exists so
 * that something stray — a backup, or a file that grows while it is read —
 * cannot be pulled into the compositor process in its entirety.
 */
export const MAX_FILE_BYTES = 256 * 1024;

/**
 * @param {Error} error Anything thrown by a Gio call.
 * @param {number} code A Gio.IOErrorEnum member.
 * @returns {boolean} Whether the error is that code.
 */
export function isIOError(error, code) {
    return typeof error?.matches === 'function' && error.matches(Gio.IOErrorEnum, code);
}

/**
 * @param {string} path Any path.
 * @param {string} attributes Attributes to ask for.
 * @param {Gio.Cancellable|null} cancellable Canceled when superseded.
 * @returns {Promise<Gio.FileInfo|null>} Its info, following symlinks, or
 *   null when there is nothing there.
 */
async function queryInfo(path, attributes, cancellable) {
    try {
        return await Gio.File.new_for_path(path).query_info_async(
            attributes,
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
        );
    } catch (error) {
        if (isIOError(error, Gio.IOErrorEnum.NOT_FOUND)) return null;
        throw error;
    }
}

/**
 * @param {string} path Any path.
 * @returns {Promise<boolean>} Whether anything is there.
 */
export async function pathExists(path) {
    return (await queryInfo(path, 'standard::type', null)) !== null;
}

/**
 * Whether a program is on PATH, as GLib.find_program_in_path would say.
 *
 * Reimplemented rather than called because that function is synchronous, and
 * PATH in a user session commonly includes directories under the home — the
 * one filesystem this file assumes may be slow. Empty entries, which mean the
 * working directory, are skipped: gnome-shell's working directory is nothing
 * the user chose.
 *
 * @param {string} name A program name.
 * @returns {Promise<boolean>} Whether an executable file of that name exists.
 */
export async function isProgramInPath(name) {
    const dirs = (GLib.getenv('PATH') ?? '/usr/bin:/bin').split(':');

    for (const dir of dirs) {
        if (dir === '') continue;

        let info;
        try {
            info = await queryInfo(
                joinPath(dir, name),
                'standard::type,access::can-execute',
                null,
            );
        } catch {
            // An unreadable PATH entry is skipped, as GLib skips it.
            continue;
        }

        if (
            info?.get_file_type() === Gio.FileType.REGULAR &&
            info.get_attribute_boolean('access::can-execute')
        )
            return true;
    }

    return false;
}

/**
 * The deepest ancestor of a path that exists, the path itself included.
 *
 * @param {string} path Absolute path that may not exist.
 * @returns {Promise<string|null>} That ancestor, or null.
 */
export async function nearestExisting(path) {
    for (let file = Gio.File.new_for_path(path); file; file = file.get_parent()) {
        const at = file.get_path();
        if (await pathExists(at)) return at;
    }

    return null;
}

/**
 * Read a file as text, refusing anything over MAX_FILE_BYTES.
 *
 * Read through a stream with a byte budget rather than with
 * load_contents_async, which has no limit: a file that grows between being
 * listed and being read, or is swapped for a symlink to /dev/zero, would
 * otherwise be read until gnome-shell runs out of memory.
 *
 * @param {string} path File to read.
 * @param {Gio.Cancellable|null} cancellable Canceled when superseded.
 * @returns {Promise<string>} Its contents.
 * @throws {Error} When it cannot be read, is not a regular file, or is larger
 *   than the limit.
 */
export async function readText(path, cancellable = null) {
    // Opening a FIFO blocks a GIO worker thread until something writes to it,
    // which may be never, and a device node has no end. Only a regular file —
    // or a symlink to one, which is followed — is ever opened.
    const file = Gio.File.new_for_path(path);
    const info = await file.query_info_async(
        'standard::type',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        cancellable,
    );
    if (info.get_file_type() !== Gio.FileType.REGULAR)
        throw new Error('not a regular file');

    const stream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);

    try {
        const chunks = [];
        let total = 0;

        // One byte over the limit is asked for, so a file of exactly the
        // limit is accepted and anything longer is caught without reading on.
        for (;;) {
            const bytes = await stream.read_bytes_async(
                MAX_FILE_BYTES + 1 - total,
                GLib.PRIORITY_DEFAULT,
                cancellable,
            );
            const chunk = bytes.toArray();
            if (chunk.length === 0) break;

            total += chunk.length;
            if (total > MAX_FILE_BYTES)
                throw new Error(`larger than ${MAX_FILE_BYTES} bytes`);

            chunks.push(chunk);
        }

        const contents = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            contents.set(chunk, offset);
            offset += chunk.length;
        }

        return DECODER.decode(contents);
    } finally {
        // Not canceled with the read: a stream left open is a file
        // descriptor leaked for as long as gnome-shell runs.
        await stream.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
    }
}
