/**
 * Whether touch is the only way in.
 *
 * Not a width test. A narrow window on a laptop still has a keyboard, and a
 * tablet with one attached reports a fine pointer -- so a layout that branches
 * on width will hand a desktop player the phone game the moment they narrow
 * their browser. `(hover: none) and (pointer: coarse)` is the pair that actually
 * means "there is no mouse and no keyboard here".
 *
 * The same query appears in `app.css`, which cannot read a constant from here.
 * Both sides carry a note pointing at the other; if one moves, the other has to.
 */
export const TOUCH_PRIMARY_QUERY = '(hover: none) and (pointer: coarse)';

export function touchPrimary(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(TOUCH_PRIMARY_QUERY).matches;
}
