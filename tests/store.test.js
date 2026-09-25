import { beforeEach, describe, expect, it, vi } from 'vitest';

import Gio, {
    closedEnumerators,
    enumerators,
    fs,
    monitors,
    reset as resetGio,
} from './stubs/gi-gio.js';
import { env, runTimeouts, timeouts, reset as resetGLib } from './stubs/gi-glib.js';
import { FakeSettings } from './stubs/settings.js';
import { flatpakConfigDir, flatpakDataDir } from '../modules/paths.js';
import { ProfileStore } from '../modules/store.js';

const HOME = '/home/tester';
const FLATPAK_DATA = flatpakDataDir(HOME);
const FLATPAK_CONFIG = flatpakConfigDir(HOME);

/** Let every pending promise in the store finish. */
async function settle() {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * @param {string} path A directory.
 * @returns {object|undefined} The live monitor on it, if there is one.
 */
function monitorOn(path) {
    return monitors.findLast(monitor => monitor.path === path && !monitor.cancelled);
}

/** Fire every queued debounce and let what it started finish. */
async function flush() {
    runTimeouts();
    await settle();
}

/**
 * @param {string} name File name, without the directory.
 * @param {object} fields Profile fields.
 * @param {string} [dir] Directory to write into.
 */
function writeProfile(name, fields, dir = FLATPAK_DATA) {
    const body = Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    fs.write(`${dir}/${name}`, `[remmina]\n${body}\n`);
}

/**
 * @param {FakeSettings} settings Settings to drive it with.
 * @returns {Promise<ProfileStore>} A store that has finished its first scan.
 */
async function newStore(settings = new FakeSettings()) {
    const store = new ProfileStore(settings);
    await settle();
    return store;
}

beforeEach(() => {
    resetGio();
    resetGLib();
    env.home = HOME;
    fs.mkdir(HOME);
});

describe('finding the directory', () => {
    it('detects the flatpak data directory', async () => {
        fs.mkdir(FLATPAK_DATA);

        const store = await newStore();

        expect(store._directory).toBe(FLATPAK_DATA);
        expect(store.source).toBe('flatpak');
    });

    it('prefers a native install when remmina is on PATH', async () => {
        fs.mkdir(FLATPAK_DATA);
        fs.program('/usr/bin/remmina');

        const store = await newStore();

        expect(store._directory).toBe(`${HOME}/.local/share/remmina`);
        expect(store.source).toBe('native');
    });

    it('honors datadir_path from remmina.pref', async () => {
        fs.mkdir(FLATPAK_DATA);
        fs.write(
            `${FLATPAK_CONFIG}/remmina.pref`,
            '[remmina_pref]\nsecret=KEY\ndatadir_path=/srv/profiles\n',
        );

        const store = await newStore();

        expect(store._directory).toBe('/srv/profiles');
        expect(store.source).toBe('datadir');
    });

    it('reports nothing found when Remmina is not installed', async () => {
        const store = await newStore();

        expect(store._directory).toBe('');
        expect(store.source).toBe('none');
        expect(store.profiles).toEqual([]);
    });
});

describe('scanning', () => {
    beforeEach(() => fs.mkdir(FLATPAK_DATA));

    it('reads every profile and sorts them by name', async () => {
        writeProfile('c.remmina', { name: 'zeta', protocol: 'SSH' });
        writeProfile('a.remmina', { name: 'Alpha', protocol: 'RDP' });
        writeProfile('b.remmina', { name: 'mid', protocol: 'VNC' });

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Alpha', 'mid', 'zeta']);
        expect(store.profiles.map(p => p.protocol)).toEqual(['RDP', 'VNC', 'SSH']);
    });

    it('ignores files that are not profiles, and directories that look like one', async () => {
        writeProfile('real.remmina', { name: 'Real' });
        fs.write(`${FLATPAK_DATA}/notes.txt`, 'ignore me');
        fs.write(`${FLATPAK_DATA}/remmina.pref`, '[remmina_pref]\n');
        fs.mkdir(`${FLATPAK_DATA}/decoy.remmina`);

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Real']);
    });

    it('never carries an encrypted field out of the file', async () => {
        writeProfile('secret.remmina', {
            name: 'Has secrets',
            password: 'Zm9vYmFy',
            ssh_passphrase: 'cGhyYXNl',
        });

        const store = await newStore();

        expect(JSON.stringify(store.profiles)).not.toMatch(/Zm9vYmFy|cGhyYXNl/);
    });

    it('reports an empty directory as empty, not as missing', async () => {
        const store = await newStore();

        expect(store.profiles).toEqual([]);
        expect(store._directory).toBe(FLATPAK_DATA);
    });

    it('notifies once the scan lands', async () => {
        writeProfile('a.remmina', { name: 'Alpha' });

        const store = new ProfileStore(new FakeSettings());
        const seen = [];
        store.connect('notify::profiles', () => seen.push(store.profiles.length));

        await settle();

        expect(seen.at(-1)).toBe(1);
    });
});

describe('watching', () => {
    it('watches the profile directory when it exists', async () => {
        fs.mkdir(FLATPAK_DATA);

        await newStore();

        expect(monitorOn(FLATPAK_DATA)).toBeDefined();
    });

    it('watches the nearest existing ancestor when it does not, then moves on', async () => {
        // A fresh Remmina install has the app directory but no profile
        // directory. Watching the ancestor is what makes it appearing an event.
        const ancestor = `${HOME}/.var/app/org.remmina.Remmina`;
        fs.mkdir(ancestor);
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings({ 'profile-dir': `${ancestor}/later` });

        const store = await newStore(settings);
        expect(monitorOn(ancestor)).toBeDefined();

        fs.mkdir(`${ancestor}/later`);
        fs.write(`${ancestor}/later/new.remmina`, '[remmina]\nname=New\n');

        monitorOn(ancestor).fire('later');
        await flush();

        expect(monitorOn(ancestor)).toBeUndefined();
        expect(monitorOn(`${ancestor}/later`)).toBeDefined();
        expect(store.profiles.map(p => p.name)).toEqual(['New']);
    });

    it('picks up an added profile without an enable cycle', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();
        expect(store.profiles).toEqual([]);

        writeProfile('new.remmina', { name: 'Fresh', protocol: 'SSH' });
        monitorOn(FLATPAK_DATA).fire();
        await flush();

        expect(store.profiles.map(p => p.name)).toEqual(['Fresh']);
    });

    it('picks up a removed profile', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('gone.remmina', { name: 'Gone' });
        const store = await newStore();
        expect(store.profiles).toHaveLength(1);

        fs.remove(`${FLATPAK_DATA}/gone.remmina`);
        monitorOn(FLATPAK_DATA).fire();
        await flush();

        expect(store.profiles).toEqual([]);
    });

    it('coalesces a burst of events into a single rescan', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();

        const scan = vi.spyOn(Gio.File.prototype, 'enumerate_children_async');
        const monitor = monitorOn(FLATPAK_DATA);

        // Remmina rewrites a profile in several steps when it saves.
        for (let i = 0; i < 5; i++) monitor.fire();

        expect(timeouts.size).toBe(1);

        runTimeouts();
        await settle();

        expect(scan).toHaveBeenCalledTimes(1);
        scan.mockRestore();
        expect(store.profiles).toEqual([]);
    });

    it('lets the newest scan win when two overlap', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('a.remmina', { name: 'First' });
        const store = await newStore();

        // Two rescans in flight at once. The older one is canceled by the
        // newer, so what lands is the newer directory state.
        fs.remove(`${FLATPAK_DATA}/a.remmina`);
        const stale = store._refresh();
        writeProfile('b.remmina', { name: 'Second' });
        const fresh = store._refresh();

        await Promise.all([stale, fresh]);
        await settle();

        expect(store.profiles.map(p => p.name)).toEqual(['Second']);
    });

    it('drops a scan that was superseded after its last read', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('a.remmina', { name: 'Published' });
        const store = await newStore();
        expect(store.profiles.map(p => p.name)).toEqual(['Published']);

        // Canceling covers a scan that is still reading. It cannot cover the
        // window between the last read resolving and the result being
        // published, which is what the generation counter is for: bump it the
        // way a newer refresh would and the older result must be thrown away.
        fs.remove(`${FLATPAK_DATA}/a.remmina`);
        writeProfile('b.remmina', { name: 'Superseded' });

        const inFlight = store._refresh();
        store._generation++;
        await inFlight;
        await settle();

        expect(store.profiles.map(p => p.name)).toEqual(['Published']);
    });
});

describe('recovering when Remmina appears later', () => {
    it('picks up a Flatpak installed after the extension', async () => {
        // The first Flatpak launch creates the data directory. Without a watch
        // on where detection looks, the menu said "Remmina not found" until
        // the next login.
        fs.mkdir(`${HOME}/.var/app`);
        const store = await newStore();
        expect(store.source).toBe('none');

        fs.mkdir(FLATPAK_DATA);
        writeProfile('first.remmina', { name: 'First' });
        monitorOn(`${HOME}/.var/app`).fire('org.remmina.Remmina');
        await flush();

        expect(store.source).toBe('flatpak');
        expect(store.profiles.map(p => p.name)).toEqual(['First']);
        expect(monitorOn(FLATPAK_DATA)).toBeDefined();
    });

    it('follows a datadir_path set in remmina.pref later', async () => {
        fs.mkdir(FLATPAK_DATA);
        fs.mkdir(FLATPAK_CONFIG);
        fs.write('/srv/profiles/x.remmina', '[remmina]\nname=Moved\n');
        const store = await newStore();
        expect(store.source).toBe('flatpak');

        fs.write(
            `${FLATPAK_CONFIG}/remmina.pref`,
            '[remmina_pref]\ndatadir_path=/srv/profiles\n',
        );
        monitorOn(FLATPAK_CONFIG).fire('remmina.pref');
        await flush();

        expect(store.source).toBe('datadir');
        expect(store.profiles.map(p => p.name)).toEqual(['Moved']);
    });

    it('ignores unrelated events next to where it looks', async () => {
        // The nearest existing ancestor can be the home directory itself,
        // which other programs write to all the time.
        const store = await newStore();
        const detect = vi.spyOn(Gio.File.prototype, 'query_info_async');

        monitorOn(HOME).fire('.bash_history');
        await flush();

        expect(detect).not.toHaveBeenCalled();
        detect.mockRestore();
        expect(store.source).toBe('none');
    });

    it('stops watching where detection looks once an override decides', async () => {
        const settings = new FakeSettings();
        await newStore(settings);
        expect(monitorOn(HOME)).toBeDefined();

        fs.mkdir('/srv/set');
        settings.set_string('profile-dir', '/srv/set');
        await flush();

        expect(monitors.filter(monitor => !monitor.cancelled).map(m => m.path)).toEqual(
            ['/srv/set'],
        );
    });
});

describe('overlapping resolves', () => {
    it('lets the newest win even when an older one finishes last', async () => {
        // The preferences window writes profile-dir on every keystroke. A
        // resolve that started earlier but took longer — automatic detection
        // probes more than an override does — must not land on top.
        fs.mkdir(FLATPAK_DATA);
        fs.mkdir('/srv/typed');
        const settings = new FakeSettings();
        const store = new ProfileStore(settings);

        settings.values.set('profile-dir', '/srv/typed');
        store.reload();
        await settle();

        expect(store._directory).toBe('/srv/typed');
        expect(store.source).toBe('override');
    });

    it('waits for typing to stop before resolving', async () => {
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings();
        const store = await newStore(settings);
        const resolve = vi.spyOn(store, 'reload');

        for (const typed of ['/', '/s', '/sr', '/srv'])
            settings.set_string('profile-dir', typed);
        expect(resolve).not.toHaveBeenCalled();

        await flush();

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(store._directory).toBe('/srv');
    });
});

describe('the changed signal', () => {
    it('fires once when a resolve moves the source and the profiles together', async () => {
        fs.mkdir(FLATPAK_DATA);
        writeProfile('a.remmina', { name: 'A' });
        const settings = new FakeSettings();
        const store = await newStore(settings);

        let changes = 0;
        store.connect('changed', () => changes++);

        settings.set_string('profile-dir', '/srv/empty');
        await flush();

        expect(store.source).toBe('override');
        expect(store.profiles).toEqual([]);
        expect(changes).toBe(1);
    });

    it('fires when only the source moved, so the empty-list message updates', async () => {
        const settings = new FakeSettings();
        const store = await newStore(settings);
        expect(store.source).toBe('none');

        let changes = 0;
        store.connect('changed', () => changes++);

        settings.set_string('profile-dir', 'relative/path');
        await flush();

        expect(store.source).toBe('invalid');
        expect(changes).toBe(1);
    });
});

describe('settings changes', () => {
    it('re-resolves and moves the watch when profile-dir changes', async () => {
        fs.mkdir(FLATPAK_DATA);
        fs.mkdir('/srv/elsewhere');
        fs.write('/srv/elsewhere/x.remmina', '[remmina]\nname=Elsewhere\n');

        const settings = new FakeSettings();
        const store = await newStore(settings);
        expect(store._directory).toBe(FLATPAK_DATA);

        settings.set_string('profile-dir', '/srv/elsewhere');
        await flush();

        expect(store._directory).toBe('/srv/elsewhere');
        expect(store.source).toBe('override');
        expect(monitorOn('/srv/elsewhere')).toBeDefined();
        expect(monitorOn(FLATPAK_DATA)).toBeUndefined();
        expect(store.profiles.map(p => p.name)).toEqual(['Elsewhere']);
    });
});

describe('destroy', () => {
    it('lets go of every handler, source and monitor', async () => {
        fs.mkdir(FLATPAK_DATA);
        const settings = new FakeSettings();
        const store = await newStore(settings);

        const handed = [...monitors];
        expect(handed.length).toBeGreaterThan(1);
        monitorOn(FLATPAK_DATA).fire();
        settings.set_string('profile-dir', '/elsewhere');
        expect(timeouts.size).toBe(2);

        store.destroy();

        expect(settings.handlerCount).toBe(0);
        for (const monitor of handed) {
            expect(monitor.handlerCount).toBe(0);
            expect(monitor.cancelled).toBe(true);
        }
        expect(timeouts.size).toBe(0);
        expect(store.profiles).toEqual([]);
    });

    it('is inert afterwards, even if a late event arrives', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();
        const monitor = monitorOn(FLATPAK_DATA);

        store.destroy();

        writeProfile('late.remmina', { name: 'Too late' });
        monitor.fire();
        await flush();

        expect(store.profiles).toEqual([]);
    });

    it('can be called twice', async () => {
        fs.mkdir(FLATPAK_DATA);
        const store = await newStore();

        store.destroy();
        expect(() => store.destroy()).not.toThrow();
    });
});

describe('scanning hygiene', () => {
    beforeEach(() => fs.mkdir(FLATPAK_DATA));

    it('closes every enumerator it opens', async () => {
        writeProfile('a.remmina', { name: 'A' });
        await newStore();

        expect(enumerators.length).toBeGreaterThan(0);
        expect(closedEnumerators.length).toBe(enumerators.length);
    });

    it('skips an implausibly large file rather than reading it', async () => {
        writeProfile('normal.remmina', { name: 'Normal' });
        // A stray backup must not be pulled into the compositor process.
        fs.write(
            `${FLATPAK_DATA}/huge.remmina`,
            '[remmina]\nname=Huge\n',
            4 * 1024 * 1024,
        );

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Normal']);
    });

    it('stops reading a file that turns out larger than it was listed', async () => {
        // The listing is not the last word: a file can grow between being
        // listed and being read. The read itself is capped too.
        writeProfile('normal.remmina', { name: 'Normal' });
        fs.write(
            `${FLATPAK_DATA}/grows.remmina`,
            `[remmina]\nname=Grows\n#${'x'.repeat(300 * 1024)}\n`,
            20,
        );

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Normal']);
    });

    it('never opens a FIFO or a device named like a profile', async () => {
        // Gio lists both as FileType.SPECIAL with size 0, so a size cap alone
        // lets them through. A link to /dev/zero would then be read until
        // gnome-shell ran out of memory, and a FIFO would block a GIO worker
        // thread forever.
        writeProfile('normal.remmina', { name: 'Normal' });
        fs.special(`${FLATPAK_DATA}/fifo.remmina`);
        fs.special('/dev/zero');
        fs.symlink(`${FLATPAK_DATA}/zero.remmina`, '/dev/zero');

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Normal']);
        expect(fs.openedSpecial).toEqual([]);
    });

    it('still follows a symlink to a regular profile', async () => {
        fs.write('/srv/shared/team.remmina', '[remmina]\nname=Shared\n');
        fs.symlink(`${FLATPAK_DATA}/team.remmina`, '/srv/shared/team.remmina');

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Shared']);
    });

    it('keeps the rest of the list when one profile cannot be read', async () => {
        writeProfile('good.remmina', { name: 'Good' });
        writeProfile('bad.remmina', { name: 'Bad' });
        fs.unreadable.add(`${FLATPAK_DATA}/bad.remmina`);

        const store = await newStore();

        expect(store.profiles.map(p => p.name)).toEqual(['Good']);
    });

    it('does not rebuild the menu when a rescan finds nothing new', async () => {
        writeProfile('a.remmina', { name: 'Stable' });
        const store = await newStore();

        let notifications = 0;
        store.connect('notify::profiles', () => notifications++);

        // The watch sits on a busy ancestor whenever the profile directory does
        // not exist yet, so unrelated events are the normal case, not the
        // exception. Rebuilding on those drops hover and focus under the mouse.
        for (let i = 0; i < 3; i++) {
            monitorOn(FLATPAK_DATA).fire();
            await flush();
        }

        expect(notifications).toBe(0);
        expect(store.profiles.map(p => p.name)).toEqual(['Stable']);
    });

    it('still notifies when a rescan does find a change', async () => {
        writeProfile('a.remmina', { name: 'Stable' });
        const store = await newStore();

        let notifications = 0;
        store.connect('notify::profiles', () => notifications++);

        writeProfile('b.remmina', { name: 'New' });
        monitorOn(FLATPAK_DATA).fire();
        await flush();

        expect(notifications).toBe(1);
        expect(store.profiles.map(p => p.name)).toEqual(['New', 'Stable']);
    });
});
