// resource:///org/gnome/shell/misc/animationUtils.js, as far as modules/panel.js
// uses it.

/** Every ensureActorVisibleInScrollView call, in order. */
export const scrolls = [];

/**
 * As the real one: the actor must be inside the scroll view, or it throws.
 *
 * @param {object} scrollView The scroll view.
 * @param {object} actor An actor inside it.
 */
export function ensureActorVisibleInScrollView(scrollView, actor) {
    for (
        let parent = actor.get_parent();
        parent !== scrollView;
        parent = parent.get_parent()
    )
        if (!parent) throw new Error('actor not in scroll view');

    scrolls.push({ scrollView, actor });
}
