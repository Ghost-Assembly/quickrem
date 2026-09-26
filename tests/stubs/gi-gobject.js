// GObject, as far as the extension uses it.
//
// registerClass is the identity. The construction path it provides in real GJS
// — new X(args) dispatching to _init — is provided instead by FakeActor's
// constructor, so a subclass written the way gnome-shell writes them works
// unchanged under Vitest.
//
// GObject.Object is a plain signal emitter, for code that subclasses it
// directly rather than an actor: connect, emit and notify, plus the two
// signal-tracker methods gnome-shell adds to every GObject.

/**
 * The signal behavior a non-actor GObject needs. `connectObject` and
 * `disconnectObject` are gnome-shell's additions, not GObject's, but they are
 * on every GObject inside the Shell.
 */
export class SignalEmitter {
    constructor() {
        this._handlers = [];
        this._nextId = 1;
    }

    /**
     * @param {string} signal Signal name.
     * @param {Function} callback Handler.
     * @returns {number} A handler id.
     */
    connect(signal, callback) {
        const id = this._nextId++;
        this._handlers.push({ id, signal, callback, owner: null });
        return id;
    }

    /**
     * @param {number} id Handler id returned by connect().
     */
    disconnect(id) {
        this._handlers = this._handlers.filter(handler => handler.id !== id);
    }

    /**
     * @param {...any} args Pairs of signal and handler, then the owner object.
     */
    connectObject(...args) {
        const owner = args.pop();

        for (let i = 0; i < args.length; i += 2) {
            const [signal, callback] = args.slice(i, i + 2);
            this._handlers.push({ id: this._nextId++, signal, callback, owner });
        }
    }

    /**
     * @param {object} owner Object whose handlers should go.
     */
    disconnectObject(owner) {
        this._handlers = this._handlers.filter(handler => handler.owner !== owner);
    }

    /**
     * @param {string} signal Signal to emit.
     * @param {...any} params Extra arguments for handlers.
     */
    emit(signal, ...params) {
        for (const handler of [...this._handlers])
            if (handler.signal === signal) handler.callback(this, ...params);
    }

    /**
     * @param {string} property Property that changed.
     */
    notify(property) {
        this.emit(`notify::${property}`);
    }

    /** @returns {number} Handlers still attached, for leak assertions. */
    get handlerCount() {
        return this._handlers.length;
    }
}

const paramSpec = () => ({});

export default {
    registerClass(...args) {
        // Real registerClass accepts an optional metadata object first.
        return args.at(-1);
    },

    Object: SignalEmitter,

    ParamFlags: { READABLE: 1, WRITABLE: 2, READWRITE: 3 },
    BindingFlags: { DEFAULT: 0, SYNC_CREATE: 1, BIDIRECTIONAL: 2 },

    ParamSpec: {
        jsobject: paramSpec,
        string: paramSpec,
        boolean: paramSpec,
        int: paramSpec,
    },
};
