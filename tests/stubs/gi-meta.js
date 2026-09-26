// Meta, as far as the extension uses it.
//
// Values match Mutter's where a test asserts on them; where they do not matter
// they are distinct integers, so a mix-up shows up as a failure rather than a
// coincidence. Tests compare against these constants, never the numbers.

export default {
    WindowType: { NORMAL: 0, DIALOG: 1, DOCK: 2 },

    KeyBindingFlags: { NONE: 0, IGNORE_AUTOREPEAT: 2 },

    // NONE is what addKeybinding returns when a keybinding of the same NAME
    // is already registered (mutter src/core/prefs.c). Accelerator collisions
    // are not detected at all. Recording a key that was never registered
    // makes disable() call removeKeybinding on it and the Shell warns.
    KeyBindingAction: { NONE: 0 },

    LaterType: { BEFORE_REDRAW: 1, IDLE: 2 },
};
