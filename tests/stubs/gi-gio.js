// Stand-in for gi://Gio, wired up by the aliases in vitest.config.js.
//
// Backed by an in-memory filesystem so modules/store.js runs exactly as it
// ships: the same enumerate/read/parse path, the same cancellation, the same
// monitor. Nothing here touches a real disk, so the tests stay fast and cannot
// depend on what Remmina happens to have saved on the machine running them.

import { SignalEmitter } from './gi-gobject.js';

export const IOErrorEnum = {
    NOT_FOUND: 1,
    IS_DIRECTORY: 3,
    PERMISSION_DENIED: 14,
    CANCELLED: 19,
};

/** A GLib.Error as GJS presents it: an Error that can be asked what it is. */
export class GioError extends Error {
    /**
     * @param {number} code A member of IOErrorEnum.
     * @param {string} message Human-readable detail.
     */
    constructor(code, message) {
        super(message);
        this.code = code;
    }

    /**
     * GJS accepts the error enum itself as the domain — Gio code writes
     * `error.matches(Gio.IOErrorEnum, code)` — so that is what is compared.
     * This once compared against a quark string no caller could pass, and
     * every NOT_FOUND and CANCELLED branch in the store was unreachable here.
     *
     * @param {object} domain Error enum to test against.
     * @param {number} code Error code to test against.
     * @returns {boolean} Whether this error is that one.
     */
    matches(domain, code) {
        return domain === IOErrorEnum && this.code === code;
    }
}

/**
 * @param {string} path Any absolute path.
 * @returns {string|null} Its parent, or null at the root.
 */
function parentOf(path) {
    if (path === '/') return null;

    const cut = path.lastIndexOf('/');
    return cut <= 0 ? '/' : path.slice(0, cut);
}

/** The in-memory filesystem. Tests drive this directly. */
export const fs = {
    /**
     * Entry types: 'dir', 'file', 'special' (a FIFO or a device node: what
     * Gio reports as FileType.SPECIAL) and 'link' (a symlink, followed the way
     * the enumerator and query_info follow one).
     *
     * @type {Map<string, {type: string, text: string, size: number}>}
     */
    entries: new Map(),

    /** Paths that exist but refuse to be read. */
    unreadable: new Set(),

    /** Special files something opened, which the real platform punishes. */
    openedSpecial: [],

    /** Empty the filesystem, leaving only the root. */
    reset() {
        this.entries.clear();
        this.unreadable.clear();
        this.openedSpecial.length = 0;
        this.entries.set('/', { type: 'dir', text: '' });
    },

    /**
     * @param {string} path Directory to create, with its ancestors.
     */
    mkdir(path) {
        for (let at = path; at; at = parentOf(at))
            if (!this.entries.has(at)) this.entries.set(at, { type: 'dir', text: '' });
    },

    /**
     * @param {string} path File to create, with its ancestors.
     * @param {string} text Its contents.
     */
    write(path, text, size) {
        this.mkdir(parentOf(path));
        this.entries.set(path, {
            type: 'file',
            text,
            size: size ?? text.length,
        });
    },

    /**
     * @param {string} path An executable file to create, as a package would.
     */
    program(path) {
        this.write(path, '');
        this.entries.get(path).executable = true;
    },

    /**
     * A FIFO or a device node. Gio lists it with size 0, and reading it never
     * ends — /dev/zero has no end, and a FIFO blocks until a writer appears —
     * so the stream this hands out yields data forever, as /dev/zero does.
     *
     * @param {string} path Where to create it.
     */
    special(path) {
        this.mkdir(parentOf(path));
        this.entries.set(path, { type: 'special', text: '', size: 0 });
    },

    /**
     * @param {string} path Where the link lives.
     * @param {string} target What it points at.
     */
    symlink(path, target) {
        this.mkdir(parentOf(path));
        this.entries.set(path, { type: 'link', target });
    },

    /**
     * @param {string} path Any path.
     * @returns {object|undefined} The entry there, with symlinks followed.
     */
    resolve(path) {
        let entry = this.entries.get(path);
        for (let hops = 0; entry?.type === 'link' && hops < 40; hops++)
            entry = this.entries.get(entry.target);

        return entry?.type === 'link' ? undefined : entry;
    },

    /**
     * @param {string} path Entry to delete.
     */
    remove(path) {
        this.entries.delete(path);
    },

    /**
     * @param {string} path Directory to list.
     * @returns {Array<string>} Its immediate children.
     */
    children(path) {
        return [...this.entries.keys()].filter(entry => parentOf(entry) === path);
    },
};

/** Every monitor handed out, so tests can fire events on them. */
export const monitors = [];

/** Argument vectors passed to Gio.Subprocess.new, in order. */
export const spawned = [];

/** Handlers registered per MIME type. Tests populate this. */
export const handlers = new Map();

/** Every launch_uris call, in order. */
export const launches = [];

/**
 * @param {string} id Desktop id the handler should report.
 * @returns {object} A stand-in for a Gio.AppInfo.
 */
export function makeHandler(id) {
    return {
        get_id: () => id,
        supports_uris: () => true,
        launch_uris(uris, context) {
            launches.push({ id, uris, context });
            return true;
        },
    };
}

/** Every enumerator handed out, so a test can assert they were all closed. */
export const enumerators = [];

/** Enumerators that had close() called on them. */
export const closedEnumerators = [];

/** Clear the filesystem and the monitor list. Call from beforeEach. */
export function reset() {
    fs.reset();
    monitors.length = 0;
    enumerators.length = 0;
    closedEnumerators.length = 0;
    spawned.length = 0;
    handlers.clear();
    launches.length = 0;
}

/**
 * @param {object|null} cancellable Cancellable to check.
 * @throws {GioError} CANCELLED when it has been canceled.
 */
function throwIfCanceled(cancellable) {
    if (cancellable?.is_cancelled())
        throw new GioError(IOErrorEnum.CANCELLED, 'Operation was cancelled');
}

class Cancellable {
    constructor() {
        this._canceled = false;
    }

    /** Cancel any operation holding this. */
    cancel() {
        this._canceled = true;
    }

    /** @returns {boolean} Whether cancel() has been called. */
    is_cancelled() {
        return this._canceled;
    }
}

const FileType = { UNKNOWN: 0, REGULAR: 1, DIRECTORY: 2, SYMBOLIC_LINK: 3, SPECIAL: 4 };

/** What Gio reports for each of the stub's entry types. */
const FILE_TYPES = new Map([
    ['dir', FileType.DIRECTORY],
    ['file', FileType.REGULAR],
    ['special', FileType.SPECIAL],
]);

class FileInfo {
    /**
     * @param {string} name Basename.
     * @param {object} entry The filesystem entry, symlinks already followed.
     */
    constructor(name, entry) {
        this._name = name;
        this._entry = entry;
    }

    /** @returns {number} Size in bytes. */
    get_size() {
        return this._entry.size ?? this._entry.text?.length ?? 0;
    }

    /** @returns {string} The basename. */
    get_name() {
        return this._name;
    }

    /** @returns {number} A FileType member. */
    get_file_type() {
        return FILE_TYPES.get(this._entry.type) ?? FileType.UNKNOWN;
    }

    /**
     * @param {string} attribute Only access::can-execute is modeled.
     * @returns {boolean} Its value.
     */
    get_attribute_boolean(attribute) {
        return attribute === 'access::can-execute' && this._entry.executable === true;
    }
}

class FileEnumerator {
    /**
     * @param {Array<string>} paths Children to hand out.
     */
    constructor(paths) {
        this._paths = [...paths];
    }

    /**
     * @param {number} count How many to return at most.
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Canceled when superseded.
     * @returns {Promise<Array<FileInfo>>} The next batch, empty when done.
     */
    async next_files_async(count, _priority, cancellable) {
        throwIfCanceled(cancellable);

        // As the real enumerator with FileQueryInfoFlags.NONE: symlinks are
        // followed, and a dangling one is skipped.
        return this._paths
            .splice(0, count)
            .map(path => [path.slice(path.lastIndexOf('/') + 1), fs.resolve(path)])
            .filter(([, entry]) => entry !== undefined)
            .map(([name, entry]) => new FileInfo(name, entry));
    }

    /**
     * Release the handle, as the real enumerator requires.
     *
     * @returns {Promise<boolean>} Always true.
     */
    async close_async() {
        this.closed = true;
        closedEnumerators.push(this);
        return true;
    }
}

/** A GLib.Bytes as GJS presents it. */
class Bytes {
    /**
     * @param {Uint8Array} data Contents.
     */
    constructor(data) {
        this._data = data;
    }

    /** @returns {Uint8Array} The contents. */
    toArray() {
        return this._data;
    }
}

class InputStream {
    /**
     * @param {object} entry What was opened.
     */
    constructor(entry) {
        this._special = entry.type === 'special';
        this._data = new TextEncoder().encode(entry.text ?? '');
        this._offset = 0;
    }

    /**
     * @param {number} count Most bytes to return.
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Canceled when superseded.
     * @returns {Promise<Bytes>} The next bytes, empty at the end.
     */
    async read_bytes_async(count, _priority, cancellable) {
        throwIfCanceled(cancellable);

        // A device node never runs out. Short reads are allowed and real, so
        // a file is handed out in small pieces to keep callers honest.
        if (this._special) return new Bytes(new Uint8Array(Math.min(count, 4096)));

        const chunk = this._data.slice(
            this._offset,
            this._offset + Math.min(count, 1024),
        );
        this._offset += chunk.length;
        return new Bytes(chunk);
    }

    /** @returns {Promise<boolean>} Always true. */
    async close_async() {
        this.closed = true;
        return true;
    }
}

class FileMonitor extends SignalEmitter {
    /**
     * @param {string} path Directory being watched.
     */
    constructor(path) {
        super();
        this.path = path;
        this.cancelled = false;
    }

    /** Stop watching. */
    cancel() {
        this.cancelled = true;
    }

    /**
     * Fire a `changed` event, as the real monitor would on a write.
     *
     * @param {string} [name] Basename of the child that changed; the real
     *   monitor always names one. Defaults to a file nobody cares about.
     */
    fire(name = 'unrelated') {
        this.emit('changed', new GioFile(`${this.path}/${name}`), null, 1);
    }
}

/**
 * Bytes g_filename_to_uri leaves alone in a path, from GLib's gconvert.c; every
 * other byte of the UTF-8 encoding is percent-encoded.
 */
const URI_SAFE = /^[A-Za-z0-9!$&'()*+,\-./:=@_~]$/;

class GioFile {
    /**
     * @param {string} path Absolute path.
     */
    constructor(path) {
        this.path = path;
    }

    /** @returns {string} The path. */
    get_path() {
        return this.path;
    }

    /** @returns {string} A file:// URI, escaped as GLib escapes it. */
    get_uri() {
        let escaped = '';
        for (const byte of new TextEncoder().encode(this.path)) {
            const char = String.fromCharCode(byte);
            escaped +=
                byte < 0x80 && URI_SAFE.test(char)
                    ? char
                    : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
        }

        return `file://${escaped}`;
    }

    /** @returns {GioFile|null} The parent, or null at the root. */
    get_parent() {
        const parent = parentOf(this.path);
        return parent ? new GioFile(parent) : null;
    }

    /**
     * @param {number} _flags Ignored.
     * @returns {FileMonitor} A monitor, recorded in `monitors`.
     */
    monitor_directory(_flags) {
        const monitor = new FileMonitor(this.path);
        monitors.push(monitor);
        return monitor;
    }

    /**
     * @param {string} _attributes Ignored; every modeled attribute is filled.
     * @param {number} _flags Ignored; symlinks are always followed.
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Canceled when superseded.
     * @returns {Promise<FileInfo>} What is at this path.
     */
    async query_info_async(_attributes, _flags, _priority, cancellable) {
        throwIfCanceled(cancellable);

        const entry = fs.resolve(this.path);
        if (!entry)
            throw new GioError(IOErrorEnum.NOT_FOUND, `${this.path} does not exist`);

        return new FileInfo(this.path.slice(this.path.lastIndexOf('/') + 1), entry);
    }

    /**
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Canceled when superseded.
     * @returns {Promise<InputStream>} A stream over the contents.
     */
    async read_async(_priority, cancellable) {
        throwIfCanceled(cancellable);

        if (fs.unreadable.has(this.path))
            throw new GioError(IOErrorEnum.PERMISSION_DENIED, `${this.path} denied`);

        const entry = fs.resolve(this.path);
        if (!entry)
            throw new GioError(IOErrorEnum.NOT_FOUND, `${this.path} does not exist`);
        if (entry.type === 'dir')
            throw new GioError(IOErrorEnum.IS_DIRECTORY, `${this.path} is a directory`);
        if (entry.type === 'special') fs.openedSpecial.push(this.path);

        return new InputStream(entry);
    }

    /**
     * @param {string} _attributes Ignored.
     * @param {number} _flags Ignored.
     * @param {number} _priority Ignored.
     * @param {object|null} cancellable Canceled when superseded.
     * @returns {Promise<FileEnumerator>} An enumerator over the children.
     */
    async enumerate_children_async(_attributes, _flags, _priority, cancellable) {
        throwIfCanceled(cancellable);

        const entry = fs.resolve(this.path);
        if (!entry || entry.type !== 'dir')
            throw new GioError(IOErrorEnum.NOT_FOUND, `${this.path} does not exist`);

        const enumerator = new FileEnumerator(fs.children(this.path));
        enumerators.push(enumerator);
        return enumerator;
    }
}

export default {
    IOErrorEnum,
    FileType,
    FileQueryInfoFlags: { NONE: 0 },
    FileMonitorFlags: { NONE: 0, WATCH_MOVES: 8 },
    SubprocessFlags: { NONE: 0 },
    SettingsBindFlags: { DEFAULT: 0, GET: 1, SET: 2, NO_SENSITIVITY: 4 },

    File: Object.assign(GioFile, {
        /**
         * @param {string} path Absolute path.
         * @returns {GioFile} A handle on it.
         */
        new_for_path: path => new GioFile(path),
    }),

    FileEnumerator,
    InputStream,
    Cancellable,

    /**
     * @param {string} name An icon name or path.
     * @returns {object} A stand-in for the Gio.Icon.
     */
    icon_new_for_string: name => ({ name }),

    AppInfo: {
        /**
         * @param {string} type A MIME type.
         * @returns {object|null} The registered handler, or null.
         */
        get_default_for_type: type => handlers.get(type) ?? null,
    },

    Subprocess: {
        /**
         * @param {Array<string>} argv Argument vector.
         * @param {number} flags Ignored.
         * @returns {object} A stand-in for the subprocess.
         */
        new(argv, flags) {
            spawned.push({ argv, flags });
            return {};
        },
    },

    /**
     * As GJS's: record the original under `_original_<name>` and return early
     * when one is already there. The stub's methods already return promises,
     * so there is nothing to wrap.
     *
     * @param {object} proto Prototype to patch.
     * @param {string} name Name of the `*_async` method.
     */
    _promisify(proto, name) {
        // Reflect rather than brackets: a computed key is the shape
        // eslint-plugin-security flags, even when the key is a literal.
        const method = Reflect.get(proto, name);
        if (method === undefined) throw new Error(`${proto} has no method ${name}`);

        const original = `_original_${name}`;
        if (Reflect.get(proto, original) !== undefined) return;

        Reflect.set(proto, original, method);
    },
};
