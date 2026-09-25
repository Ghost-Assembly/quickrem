// Stand-in for gi://St, as far as modules/panel.js uses it.

import { FakeActor } from '../support/actors.js';

const PolicyType = { ALWAYS: 0, AUTOMATIC: 1, NEVER: 2, EXTERNAL: 3 };

/** The two inline properties the panel sets, as literal patterns. */
const CSS_PX = new Map([
    ['min-height', /(?:^|;)\s*min-height:\s*(\d+)px/],
    ['max-height', /(?:^|;)\s*max-height:\s*(\d+)px/],
]);

/**
 * @param {string|null} style An inline style.
 * @param {string} property min-height or max-height.
 * @returns {number|null} Its value in px, or null when unset.
 */
function cssPx(style, property) {
    const match = CSS_PX.get(property).exec(style ?? '');
    return match ? Number(match[1]) : null;
}

class Label extends FakeActor {
    constructor(props = {}) {
        super(props);
        this.clutter_text = { ellipsize: null };
    }
}

/**
 * St.ScrollView's height, as St 50 computes it. A scroll view that may
 * scroll vertically reports a minimum height of zero, because it can always
 * scroll; one that never scrolls reports its child's. Then the theme node
 * applies min-height, raising both, and max-height, capping both. The menu's
 * open animation eases to the minimum, which is why all of this matters.
 */
class ScrollView extends FakeActor {
    constructor({ child, ...props } = {}) {
        super({ vscrollbar_policy: PolicyType.AUTOMATIC, ...props });
        this.vadjustment = { value: 0 };
        if (child) this.add_child(child);
    }

    get_preferred_height(forWidth) {
        const [childMin, childNat] = this.children[0]?.get_preferred_height(
            forWidth,
        ) ?? [0, 0];
        let min = this.vscrollbar_policy === PolicyType.NEVER ? childMin : 0;
        let nat = childNat;

        const minHeight = cssPx(this.style, 'min-height');
        if (minHeight !== null) {
            min = Math.max(min, minHeight);
            nat = Math.max(nat, minHeight);
        }

        const maxHeight = cssPx(this.style, 'max-height');
        if (maxHeight !== null) {
            min = Math.min(min, maxHeight);
            nat = Math.min(nat, maxHeight);
        }

        return [min, nat];
    }
}

export default {
    PolicyType,
    BoxLayout: FakeActor,
    Label,
    ScrollView,
};
