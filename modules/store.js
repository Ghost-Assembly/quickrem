// The data layer: find the profile directory, read it, and keep reading it.
//
// Every read and every probe here is asynchronous, through modules/io.js. A
// profile directory lives on whatever the user's home is mounted from, and a
// synchronous read of it would block the compositor thread — a stutter in the
// whole desktop, not just in this menu. The one synchronous call left is
// monitor_directory(), which GIO has no asynchronous form of; it is made only
// when a watch moves, on a directory that has just been seen to exist.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import { detectProfileDir } from './detect.js';
import { MAX_FILE_BYTES, isIOError, nearestExisting, readText } from './io.js';
import { parseProfile, sameProfiles, sortProfiles } from './profiles.js';
import { PROFILE_SUFFIX, joinPath } from './paths.js';

/**
 * Remmina rewrites a profile in several steps when it saves, a file manager
 * copying profiles in emits an event per file, and the preferences window
 * writes profile-dir on every keystroke. Coalescing for this long turns each of
 * those into one rescan or one re-resolve.
 */
const DEBOUNCE_MS = 300;

/** How many directory entries to ask for per round trip. */
const BATCH_SIZE = 64;

/**
 * @param {string} path An absolute path.
 * @returns {string} Its parent directory.
 */
function parentOf(path) {
    return path.slice(0, Math.max(1, path.lastIndexOf('/')));
}

/**
 * @param {string|null} changed A path a monitor reported.
 * @param {Array<string>} targets Paths that matter.
 * @returns {boolean} Whether the change is to a target or to one of its
 *   ancestors — the ancestor appearing is how a target starts to exist.
 */
function touchesAny(changed, targets) {
    if (!changed) return false;

    return targets.some(
        target => target === changed || target.startsWith(`${changed}/`),
    );
}

export const ProfileStore = GObject.registerClass(
    {
        GTypeName: 'QuickRemProfileStore',
        Properties: {
            profiles: GObject.ParamSpec.jsobject(
                'profiles',
                'Profiles',
                'Saved Remmina profiles, sorted by name',
                GObject.ParamFlags.READABLE,
            ),
            source: GObject.ParamSpec.string(
                'source',
                'Source',
                'How the directory was chosen: override, datadir, native, flatpak, ' +
                    'none or invalid',
                GObject.ParamFlags.READABLE,
                'none',
            ),
        },
        Signals: {
            // One signal for "the menu is out of date", emitted once however
            // many of the properties above changed. A resolve that moves the
            // source usually changes the profiles too, and the panel used to
            // rebuild the menu once for each notification.
            changed: {},
        },
    },
    class ProfileStore extends GObject.Object {
        /**
         * @param {Gio.Settings} settings The extension's settings.
         */
        constructor(settings) {
            super();

            this._settings = settings;
            this._profiles = [];
            this._directory = '';
            this._source = 'none';
            this._changePending = false;

            // The profile directory, or its nearest existing ancestor.
            this._monitor = null;
            this._watchedPath = null;
            this._watchGeneration = 0;

            // Where detection looks, so Remmina being installed, its data
            // directory appearing or remmina.pref changing re-resolves on its
            // own. Keyed by the directory watched.
            this._probeMonitors = new Map();
            this._probeTargets = [];

            // Pending debounce sources, one per kind of work.
            this._refreshTimer = { id: 0 };
            this._resolveTimer = { id: 0 };
            this._cancellable = null;
            this._generation = 0;
            this._resolveGeneration = 0;

            // Pointing profile-dir somewhere else has to move the watch as well
            // as the scan, so it goes through the same path as first startup.
            this._settings.connectObject(
                'changed::profile-dir',
                () => this._queue(this._resolveTimer, () => this.reload()),
                this,
            );

            this.reload();
        }

        /** @returns {Array<object>} Profiles, sorted by name. */
        get profiles() {
            return this._profiles;
        }

        /** @returns {string} Why the directory was chosen. */
        get source() {
            return this._source;
        }

        /** Re-detect the profile directory, re-arm the watches and rescan. */
        reload() {
            this._resolve().catch(error =>
                console.warn(
                    `[quickrem] could not resolve the profile directory: ${error}`,
                ),
            );
        }

        /**
         * Tear everything down. Safe to call twice.
         *
         * Every connect above is undone here. A connect that outlives its
         * disconnect is what makes an extension leak a handler per enable, and
         * the Shell only complains about it two enables later.
         */
        destroy() {
            this._settings?.disconnectObject(this);
            this._settings = null;

            this._unwatch();
            this._unwatchProbes();

            for (const timer of [this._refreshTimer, this._resolveTimer]) {
                if (timer.id) GLib.Source.remove(timer.id);
                timer.id = 0;
            }

            // Bumping the generations strands any resolve, watch or scan
            // already in flight, so its continuation returns without touching
            // a destroyed object.
            this._generation++;
            this._resolveGeneration++;
            this._watchGeneration++;
            this._cancellable?.cancel();
            this._cancellable = null;
            this._profiles = [];
        }

        /** Probe the system, decide on a directory, then watch and scan it. */
        async _resolve() {
            // Resolves overlap whenever profile-dir changes faster than the
            // probe completes. Only the newest may publish; an older one
            // landing last would leave the store reading a directory the
            // setting no longer names.
            const generation = ++this._resolveGeneration;

            // The probe and the precedence rules both live in detect.js, so
            // this and the preferences window cannot drift apart.
            const { dir, source, watch } = await detectProfileDir(
                this._settings.get_string('profile-dir'),
            );
            if (generation !== this._resolveGeneration) return;

            if ((dir ?? '') !== this._directory) {
                this._directory = dir ?? '';
                this._changePending = true;
            }

            if (source !== this._source) {
                this._source = source;
                this._changePending = true;
                this.notify('source');
            }

            await Promise.all([this._watch(), this._watchProbes(watch)]);
            if (generation !== this._resolveGeneration) return;

            await this._refresh();
        }

        /**
         * Watch the profile directory, or the nearest ancestor that exists.
         *
         * A fresh Remmina install has no profile directory at all, and a custom
         * `datadir_path` may point at one that has not been created yet.
         * Watching the ancestor means the directory appearing is itself an
         * event, so the list fills in without an enable/disable cycle.
         */
        async _watch() {
            const generation = ++this._watchGeneration;
            const target = this._directory
                ? await nearestExisting(this._directory)
                : null;

            // A newer call owns the watch now; installing this one as well
            // would leave a monitor nothing ever cancels.
            if (generation !== this._watchGeneration) return;
            if (target === this._watchedPath) return;

            this._unwatch();
            if (!target) return;

            const monitor = this._monitorDirectory(target, () =>
                this._queue(this._refreshTimer, () => this._onRefreshTimeout()),
            );
            if (!monitor) return;

            this._monitor = monitor;
            this._watchedPath = target;
        }

        /** Drop the profile-directory monitor and its handler together. */
        _unwatch() {
            if (!this._monitor) return;

            this._monitor.disconnectObject(this);
            this._monitor.cancel();
            this._monitor = null;
            this._watchedPath = null;
        }

        /**
         * Watch where detection looks, so its answer can change on its own.
         *
         * Without this, a Remmina installed after the extension — or a first
         * Flatpak launch creating its data directory — left the menu saying
         * "Remmina not found" until the next login, and a datadir_path set in
         * Remmina's preferences was never noticed at all. Each target's parent
         * is watched, or that parent's nearest existing ancestor, and only an
         * event on a target or on one of its ancestors re-resolves: the
         * ancestor can be the home directory, which is busy.
         *
         * @param {Array<string>} targets Paths from detectProfileDir.
         */
        async _watchProbes(targets) {
            const generation = this._resolveGeneration;
            const dirs = await Promise.all(
                targets.map(target => nearestExisting(parentOf(target))),
            );
            if (generation !== this._resolveGeneration) return;

            this._probeTargets = targets;
            const wanted = new Set(dirs.filter(dir => dir !== null));

            for (const [dir, monitor] of this._probeMonitors) {
                if (wanted.has(dir)) continue;

                monitor.disconnectObject(this);
                monitor.cancel();
                this._probeMonitors.delete(dir);
            }

            for (const dir of wanted) {
                if (this._probeMonitors.has(dir)) continue;

                const monitor = this._monitorDirectory(dir, (file, otherFile) => {
                    const touched = [file, otherFile].some(changed =>
                        touchesAny(changed?.get_path() ?? null, this._probeTargets),
                    );
                    if (touched) this._queue(this._resolveTimer, () => this.reload());
                });
                if (monitor) this._probeMonitors.set(dir, monitor);
            }
        }

        /** Drop every detection monitor. */
        _unwatchProbes() {
            for (const monitor of this._probeMonitors.values()) {
                monitor.disconnectObject(this);
                monitor.cancel();
            }

            this._probeMonitors.clear();
            this._probeTargets = [];
        }

        /**
         * @param {string} dir Directory to watch.
         * @param {Function} onChanged Called with the file and other file of
         *   each event.
         * @returns {Gio.FileMonitor|null} The monitor, or null when the
         *   directory could not be watched.
         */
        _monitorDirectory(dir, onChanged) {
            let monitor;
            try {
                monitor = Gio.File.new_for_path(dir).monitor_directory(
                    Gio.FileMonitorFlags.WATCH_MOVES,
                    null,
                );
            } catch (error) {
                console.warn(`[quickrem] could not watch ${dir}: ${error}`);
                return null;
            }

            monitor.connectObject(
                'changed',
                (_monitor, file, otherFile) => onChanged(file, otherFile),
                this,
            );

            return monitor;
        }

        /**
         * Run a callback once a burst of calls has gone quiet.
         *
         * @param {{id: number}} timer Holds this debounce's pending source.
         * @param {Function} callback What to run.
         */
        _queue(timer, callback) {
            if (timer.id) GLib.Source.remove(timer.id);

            timer.id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                timer.id = 0;
                callback();

                return GLib.SOURCE_REMOVE;
            });
        }

        /** A burst of profile-directory events has gone quiet. */
        _onRefreshTimeout() {
            // The event may have been the profile directory itself being
            // created, so move the watch onto it before scanning.
            this._watch()
                .then(() => this._refresh())
                .catch(error => console.warn(`[quickrem] rescan failed: ${error}`));
        }

        /** Rescan the directory and publish the result. */
        async _refresh() {
            this._cancellable?.cancel();

            const cancellable = new Gio.Cancellable();
            this._cancellable = cancellable;
            const generation = ++this._generation;

            let profiles = [];
            if (this._directory) {
                try {
                    profiles = await this._scan(this._directory, cancellable);
                } catch (error) {
                    if (isIOError(error, Gio.IOErrorEnum.CANCELLED)) return;
                    console.warn(
                        `[quickrem] could not read ${this._directory}: ${error}`,
                    );
                }
            }

            // A scan overtaken by a newer one must not land after it, or a
            // burst of saves leaves the menu showing an older directory state.
            if (generation !== this._generation) return;

            this._cancellable = null;

            // A rescan that found nothing new must not rebuild the menu: the
            // watch can sit on a busy ancestor while the profile directory does
            // not exist, and tearing the items down under the pointer loses
            // hover and keyboard focus mid-interaction. A resolve that moved
            // the directory or the source still has to, even when the list
            // came out the same — the empty-list message depends on the source.
            const sorted = sortProfiles(profiles);
            const profilesChanged = !sameProfiles(sorted, this._profiles);
            if (!profilesChanged && !this._changePending) return;

            this._changePending = false;
            if (profilesChanged) {
                this._profiles = sorted;
                this.notify('profiles');
            }

            this.emit('changed');
        }

        /**
         * Walk an open enumerator and collect the profile paths worth reading.
         *
         * @param {Gio.FileEnumerator} enumerator An open enumerator.
         * @param {string} dir The directory it is enumerating.
         * @param {Gio.Cancellable} cancellable Canceled when superseded.
         * @returns {Promise<Array<string>>} Absolute paths to profiles.
         */
        async _collectPaths(enumerator, dir, cancellable) {
            const paths = [];

            try {
                for (;;) {
                    const infos = await enumerator.next_files_async(
                        BATCH_SIZE,
                        GLib.PRIORITY_DEFAULT,
                        cancellable,
                    );
                    if (infos.length === 0) break;

                    for (const info of infos) {
                        const path = this._profilePath(info, dir);
                        if (path) paths.push(path);
                    }
                }
            } finally {
                // Every scan opens one of these and a watch on a busy directory
                // can scan often, so the handle is closed here rather than left
                // for the garbage collector. Not with the scan's cancellable:
                // a superseded scan still has a descriptor to give back.
                await enumerator
                    .close_async(GLib.PRIORITY_DEFAULT, null)
                    .catch(() => {});
            }

            return paths;
        }

        /**
         * @param {Gio.FileInfo} info One directory entry, symlinks followed.
         * @param {string} dir The directory it came from.
         * @returns {string|null} Its path, or null when it is not a profile
         *   worth reading.
         */
        _profilePath(info, dir) {
            if (!info.get_name().endsWith(PROFILE_SUFFIX)) return null;

            // Regular files only. The enumerator follows symlinks, so a link
            // to a profile elsewhere still works, but a FIFO named *.remmina
            // would block a GIO thread forever and a link to /dev/zero reports
            // size 0 and would never stop reading. Both are FileType.SPECIAL.
            if (info.get_file_type() !== Gio.FileType.REGULAR) return null;

            // Checked here as well as while reading, so an oversized file is
            // not even opened. The read enforces it again for a file that grows.
            if (info.get_size() > MAX_FILE_BYTES) {
                console.warn(
                    `[quickrem] skipping a profile of ${info.get_size()} bytes`,
                );
                return null;
            }

            return joinPath(dir, info.get_name());
        }

        /**
         * @param {string} path Profile to read.
         * @param {Gio.Cancellable} cancellable Canceled when superseded.
         * @returns {Promise<object|null>} The parsed profile, or null when it
         *   could not be read.
         */
        async _readProfile(path, cancellable) {
            try {
                return parseProfile(await readText(path, cancellable), path);
            } catch (error) {
                if (isIOError(error, Gio.IOErrorEnum.CANCELLED)) throw error;

                // One unreadable profile must not cost the user the rest of
                // the list. Neither the path nor the error is logged: Remmina's
                // default filename embeds the server's hostname, GIO's error
                // messages quote the path, and the journal outlives the file.
                console.warn('[quickrem] skipping a profile that could not be read');
                return null;
            }
        }

        /**
         * @param {string} dir Directory to read.
         * @param {Gio.Cancellable} cancellable Canceled when superseded.
         * @returns {Promise<Array<object>>} Parsed profiles, unsorted.
         */
        async _scan(dir, cancellable) {
            let enumerator;
            try {
                enumerator = await Gio.File.new_for_path(dir).enumerate_children_async(
                    'standard::name,standard::type,standard::size',
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                );
            } catch (error) {
                // A directory that is not there yet is the normal state on a
                // fresh install, not a failure worth logging.
                if (isIOError(error, Gio.IOErrorEnum.NOT_FOUND)) return [];
                throw error;
            }

            const paths = await this._collectPaths(enumerator, dir, cancellable);

            // The reads are independent, so they go out together rather than
            // one round trip at a time — on a network-mounted home the
            // sequential version was latency-bound in the profile count.
            // Promise.all preserves order, and sortProfiles reorders anyway.
            const profiles = await Promise.all(
                paths.map(path => this._readProfile(path, cancellable)),
            );

            return profiles.filter(profile => profile !== null);
        }
    },
);
