// A recording stand-in for a Clutter actor, and the base of the St, popupMenu
// and quickSettings stubs.
//
// It exists so tests/panel.test.js can assert QuickRem's own bookkeeping — what
// is parented where, what survives a destroy, what height the menu measures —
// rather than asserting that a stub behaves like a stub. Where the real toolkit
// has a behavior the panel depends on, it is modeled here and says so.

import { SignalEmitter } from '../stubs/gi-gobject.js';

/** The behavior every fake actor shares. */
export class FakeActor extends SignalEmitter {
    /**
     * @param {object} [props] Properties to assign, as GJS does.
     */
    constructor(props = {}) {
        super();
        this.children = [];
        this.style = null;
        this.visible = true;
        this.reactive = true;
        this._parentActor = null;

        // The stub's own bookkeeping, not an API: ClutterActor has no
        // `destroyed` property, so production code must never read one.
        this._wasDestroyed = false;

        Object.assign(this, props);
    }

    /**
     * @param {FakeActor} child Actor to parent here.
     */
    add_child(child) {
        if (child._parentActor)
            throw new Error('Clutter: the actor already has a parent');

        this.children.push(child);
        child._parentActor = this;
    }

    /**
     * @param {FakeActor} child Actor to unparent.
     */
    remove_child(child) {
        this.children = this.children.filter(existing => existing !== child);
        child._parentActor = null;
    }

    /** @returns {FakeActor|null} The parent, or null. */
    get_parent() {
        return this._parentActor;
    }

    /** @returns {Array<FakeActor>} The children, in order. */
    get_children() {
        return [...this.children];
    }

    /** @returns {number} How many children there are. */
    get_n_children() {
        return this.children.length;
    }

    /**
     * A fixed row height when one was given, otherwise a vertical box: the
     * sum of the visible children. Enough for the menu's measurements.
     *
     * @param {number} forWidth Passed through to children.
     * @returns {[number, number]} Minimum and natural height.
     */
    get_preferred_height(forWidth) {
        if (this.rowHeight !== undefined) return [this.rowHeight, this.rowHeight];

        return this.children
            .filter(child => child.visible)
            .map(child => child.get_preferred_height(forWidth))
            .reduce(
                ([min, nat], [childMin, childNat]) => [min + childMin, nat + childNat],
                [0, 0],
            );
    }

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }

    /** As Clutter: 'destroy' first, then children, then unparent. */
    destroy() {
        if (this._wasDestroyed) return;

        this.emit('destroy');
        this._wasDestroyed = true;

        for (const child of [...this.children]) child.destroy();
        this._parentActor?.remove_child(this);
        this._handlers = [];
    }
}
