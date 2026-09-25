// Probing the system for where Remmina keeps its profiles.
//
// The rules live in modules/paths.js, which imports nothing so that it stays
// loadable by Vitest and by the preferences process. What could not live there
// is the probe itself — it needs Gio and GLib — and that probe used to be
// copied into both the Shell and the preferences process. Sharing the rules but
// not the wiring left six argument names and the `profile-dir` key spelled out
// twice, which is the drift both files' headers say they exist to prevent.
//
// The Shell and the preferences window both call this, and both get the same
// asynchronous I/O from modules/io.js. The Shell needs it to keep the
// compositor responsive; the preferences process merely tolerates it, and one
// code path is worth more than the synchronous reads it could have used.

import GLib from 'gi://GLib';

import { isProgramInPath, pathExists, readText } from './io.js';
import {
    detectionPaths,
    flatpakDataDir,
    prefFileCandidates,
    readDatadirPath,
    resolveProfileDir,
} from './paths.js';

/**
 * Work out which directory holds the profiles, and why.
 *
 * @param {string} override The `profile-dir` setting; blank means auto.
 * @returns {Promise<{dir: string|null, source: string, watch: Array<string>}>}
 *   The directory, the reason it was chosen (override, datadir, native,
 *   flatpak, none or invalid), and the paths whose appearance or change could
 *   alter that decision — empty when the override decides regardless.
 */
export async function detectProfileDir(override) {
    const home = GLib.get_home_dir();
    const xdgConfigHome = GLib.getenv('XDG_CONFIG_HOME');

    if ((override ?? '').trim() !== '')
        return { ...resolveProfileDir({ override, home }), watch: [] };

    const [hasNativeRemmina, hasFlatpakData] = await Promise.all([
        isProgramInPath('remmina'),
        pathExists(flatpakDataDir(home)),
    ]);

    // remmina.pref also holds `secret=`, the key stored passwords are encrypted
    // with; only datadir_path comes back out of the parser, and the text is not
    // kept.
    const datadirPath = await readDatadirPath(
        prefFileCandidates({ home, xdgConfigHome, hasNativeRemmina }),
        path => readText(path),
    );

    const resolved = resolveProfileDir({
        datadirPath,
        home,
        xdgDataHome: GLib.getenv('XDG_DATA_HOME'),
        hasNativeRemmina,
        hasFlatpakData,
    });

    return { ...resolved, watch: detectionPaths({ home, xdgConfigHome }) };
}
