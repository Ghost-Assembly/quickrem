import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Gio, {
    handlers,
    launches,
    makeHandler,
    spawned,
    reset as resetGio,
} from './stubs/gi-gio.js';
import GLib from './stubs/gi-glib.js';
import { activations, registerApp, reset as resetShell } from './stubs/gi-shell.js';
import { FakeSettings } from './stubs/settings.js';
import { launchProfile, launchRemmina } from '../modules/launch.js';

const MIME = 'application/x-remmina';
const DESKTOP_ID = 'org.remmina.Remmina.desktop';

/**
 * @param {string} launchCommand The launch-command setting.
 * @returns {FakeSettings} Settings holding just that key.
 */
const settingsWith = launchCommand =>
    new FakeSettings({ 'launch-command': launchCommand });

const profile = (path = '/profiles/a.remmina') => ({ name: 'A', path });

beforeEach(() => {
    resetGio();
    resetShell();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the GLib stand-ins these tests lean on', () => {
    // Captured from the real GLib 2.88 through GJS. If the stubs drift from
    // these, every test below is checking the stub instead of launch.js.
    it('splits a command line exactly as GLib.shell_parse_argv does', () => {
        expect(
            GLib.shell_parse_argv(`a 'b c' "d \\"e\\" \\$f \\x" g\\ h i#j # comment`),
        ).toEqual([true, ['a', 'b c', 'd "e" $f \\x', 'g h', 'i#j']]);
        expect(GLib.shell_parse_argv(`x"y"'z' \\\nw`)).toEqual([true, ['xyz', 'w']]);

        for (const bad of ['a "unclosed', '   ', 'a\\'])
            expect(() => GLib.shell_parse_argv(bad)).toThrow();
    });

    it('escapes a file URI exactly as Gio.File.get_uri does', () => {
        let printable = '';
        for (let code = 32; code < 127; code++)
            if (code !== 47) printable += String.fromCharCode(code);

        expect(Gio.File.new_for_path(`/p/${printable}é.remmina`).get_uri()).toBe(
            "file:///p/%20!%22%23$%25&'()*+,-.0123456789:%3B%3C=%3E%3F@" +
                'ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_%60abcdefghijklmnopqrstuvwxyz' +
                '%7B%7C%7D~%C3%A9.remmina',
        );
    });
});

describe('launchProfile', () => {
    it('opens the profile through the registered handler', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile(), new FakeSettings());

        expect(launches).toHaveLength(1);
        expect(launches[0].id).toBe('org.remmina.Remmina-file.desktop');
        expect(launches[0].uris).toEqual(['file:///profiles/a.remmina']);
        expect(spawned).toHaveLength(0);
    });

    it('does not throw or spawn when nothing is registered for the type', () => {
        expect(() => launchProfile(profile(), new FakeSettings())).not.toThrow();

        expect(launches).toHaveLength(0);
        expect(spawned).toHaveLength(0);
    });

    it('hands the handler an escaped URI for a path with spaces and #', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile('/profiles/My Lab #2.remmina'), new FakeSettings());

        expect(launches[0].uris).toEqual(['file:///profiles/My%20Lab%20%232.remmina']);
    });

    it('keeps the profile path out of the log when a launch fails', () => {
        // Remmina's default filename embeds the server's hostname.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        launchProfile(
            profile('/profiles/prod-db.example.com.remmina'),
            settingsWith('myremmina "unclosed'),
        );

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0].join(' ')).not.toContain('prod-db');
    });

    it('prefers an explicit launch-command over the handler', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile(), settingsWith('myremmina --connect'));

        expect(launches).toHaveLength(0);
        expect(spawned[0].argv).toEqual([
            'myremmina',
            '--connect',
            '/profiles/a.remmina',
        ]);
    });

    it('never lets a profile path become shell syntax', () => {
        // The one security invariant in the extension: the path is its own argv
        // element, so a filename containing shell metacharacters is an
        // argument, not a second command. A profile file can be created by
        // anything that can write to the profile directory.
        const nasty = '/profiles/a; rm -rf ~/.ssh; echo .remmina';

        launchProfile(profile(nasty), settingsWith('myremmina --connect'));

        expect(spawned[0].argv).toEqual(['myremmina', '--connect', nasty]);
        expect(spawned[0].argv).toHaveLength(3);
    });

    it('swallows an unparseable launch-command rather than throwing', () => {
        // An unbalanced quote makes shell_parse_argv throw. That must not
        // escape into the Shell from a menu activation.
        expect(() =>
            launchProfile(profile(), settingsWith('myremmina "unclosed')),
        ).not.toThrow();

        expect(spawned).toHaveLength(0);
    });

    it('trims a launch-command that is only whitespace and uses the handler', () => {
        handlers.set(MIME, makeHandler('org.remmina.Remmina-file.desktop'));

        launchProfile(profile(), settingsWith('   '));

        expect(launches).toHaveLength(1);
        expect(spawned).toHaveLength(0);
    });
});

describe('launchRemmina', () => {
    it('activates the desktop entry through the app system', () => {
        registerApp(DESKTOP_ID);

        launchRemmina(new FakeSettings());

        expect(activations).toEqual([DESKTOP_ID]);
    });

    it('does not throw when Remmina is not installed', () => {
        expect(() => launchRemmina(new FakeSettings())).not.toThrow();

        expect(activations).toHaveLength(0);
    });

    it('runs launch-command with no path appended', () => {
        registerApp(DESKTOP_ID);

        launchRemmina(settingsWith('myremmina --tray'));

        expect(activations).toHaveLength(0);
        expect(spawned[0].argv).toEqual(['myremmina', '--tray']);
    });
});
