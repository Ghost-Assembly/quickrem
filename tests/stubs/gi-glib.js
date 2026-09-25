// Stand-in for gi://GLib, wired up by the aliases in vitest.config.js.
//
// Timeouts are queued rather than scheduled: modules/store.js debounces file
// events through GLib.timeout_add, and a test that had to wait 300 ms of real
// time for each assertion would be slow and flaky. runTimeouts() fires them on
// demand instead, which also makes "the debounce coalesced these five events
// into one rescan" directly observable.

/** Environment the stub reports. Tests set these in beforeEach. */
export const env = {
    home: '/home/tester',
    variables: new Map(),
};

/**
 * GLib.shell_parse_argv, following the rules in GLib's gshell.c rather than
 * approximating them with a regex — a stub that splits differently from the
 * real thing makes tests/launch.test.js check the stub. Modeled: blanks
 * separate words; single quotes are literal; inside double quotes a backslash
 * escapes only $ ` " \ and newline; outside quotes it escapes any character
 * and a backslash-newline disappears; `#` at the start of a word comments out
 * the rest of the line; quoted and unquoted runs join into one word. Errors, as
 * in GLib: an unmatched quote, a trailing backslash, and text that is empty or
 * only blanks. tests/launch.test.js pins this against output captured from
 * the real GLib.shell_parse_argv, so the model cannot drift unnoticed.
 *
 * @param {string} command A command line.
 * @returns {[boolean, Array<string>]} Success and the argument vector.
 * @throws {Error} On the errors listed above.
 */
function shellParseArgv(command) {
    const argv = [];
    let word = null;
    let i = 0;

    const push = char => {
        word = (word ?? '') + char;
    };

    while (i < command.length) {
        const char = command.charAt(i);

        if (char === ' ' || char === '\t' || char === '\n') {
            if (word !== null) argv.push(word);
            word = null;
            i++;
        } else if (char === '#' && word === null) {
            while (i < command.length && command.charAt(i) !== '\n') i++;
        } else if (char === "'") {
            const end = command.indexOf("'", i + 1);
            if (end === -1)
                throw new Error('Text ended before matching quote was found');
            push(command.slice(i + 1, end));
            i = end + 1;
        } else if (char === '"') {
            i++;
            push('');
            for (;;) {
                if (i >= command.length)
                    throw new Error('Text ended before matching quote was found');
                const inner = command.charAt(i);
                if (inner === '"') break;
                if (inner === '\\' && '$`"\\\n'.includes(command.charAt(i + 1))) {
                    if (command.charAt(i + 1) !== '\n') push(command.charAt(i + 1));
                    i += 2;
                } else {
                    push(inner);
                    i++;
                }
            }
            i++;
        } else if (char === '\\') {
            if (i + 1 >= command.length)
                throw new Error('Text ended just after a “\\” character.');
            if (command.charAt(i + 1) !== '\n') push(command.charAt(i + 1));
            i += 2;
        } else {
            push(char);
            i++;
        }
    }

    if (word !== null) argv.push(word);
    if (argv.length === 0)
        throw new Error('Text was empty (or contained only whitespace)');

    return [true, argv];
}

/** Pending timeout callbacks, by source id. */
export const timeouts = new Map();

let nextSourceId = 1;

/** Fire every queued timeout once, in the order they were added. */
export function runTimeouts() {
    const pending = [...timeouts.entries()];
    timeouts.clear();

    for (const [, callback] of pending) callback();
}

/** Clear all recorded state. Call from beforeEach. */
export function reset() {
    env.home = '/home/tester';
    env.variables.clear();
    timeouts.clear();
    nextSourceId = 1;
}

export default {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    SOURCE_CONTINUE: true,

    /** @returns {string} The stubbed home directory. */
    get_home_dir: () => env.home,

    /**
     * @param {string} name Variable name.
     * @returns {string|null} Its value, or null.
     */
    getenv: name => env.variables.get(name) ?? null,

    /**
     * @param {number} _priority Ignored.
     * @param {number} _interval Ignored; runTimeouts() controls firing.
     * @param {Function} callback The timeout body.
     * @returns {number} A source id.
     */
    timeout_add(_priority, _interval, callback) {
        const id = nextSourceId++;
        timeouts.set(id, callback);
        return id;
    },

    shell_parse_argv: shellParseArgv,

    Source: {
        /**
         * @param {number} id Source to drop.
         */
        remove(id) {
            timeouts.delete(id);
        },
    },
};
