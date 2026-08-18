/**
 * The bindings, as data.
 *
 * One table, read by both the input controller and the key map in settings. The
 * settings panel could have listed the controls in its own words, and that is
 * exactly how a key map goes stale: it would have been right on the day it was
 * written and wrong by the next binding change, with nothing to catch it. Here
 * the panel cannot describe a key the engine does not answer to, because it is
 * reading the same rows.
 *
 * Writing the table out is also what found the gap it now documents. The depth
 * nudge takes `-1 | 1` and the design spec says it "shifts the piece +/-1 lane",
 * but only one direction had ever been bound: `W` moved the piece nearer and
 * nothing moved it away. The spec's suggested pair was `W` / `S`, which cannot
 * work, because `S` is half of the WASD movement cluster the README advertises
 * and is already the soft drop. So depth takes its own vertical pair, `T` and
 * `G`, sitting next to the `R` / `F` used for pitch: two spatial axes, two
 * adjacent pairs, and neither of them stealing a movement key.
 */

/** Everything the player can ask for. */
export type Action =
  | 'moveLeft'
  | 'moveRight'
  | 'softDrop'
  | 'hardDrop'
  | 'rollAnti'
  | 'rollClock'
  | 'yawAnti'
  | 'yawClock'
  | 'pitchUp'
  | 'pitchDown'
  | 'nudgeNearer'
  | 'nudgeDeeper'
  | 'hold'
  | 'pause'
  | 'mute'
  | 'restart';

export interface Binding {
  readonly action: Action;
  /** `KeyboardEvent.code` values, in the order they should be shown. */
  readonly codes: readonly string[];
  /** What it does, in the player's words. */
  readonly label: string;
  readonly group: BindingGroup;
  /**
   * Shown alongside the row when the control is not always available.
   */
  readonly note?: string;
}

export type BindingGroup = 'Move' | 'Rotate' | 'Depth' | 'Game';

export const BINDING_GROUPS: readonly BindingGroup[] = ['Move', 'Rotate', 'Depth', 'Game'];

export const BINDINGS: readonly Binding[] = [
  { action: 'moveLeft', codes: ['ArrowLeft', 'KeyA'], label: 'Left', group: 'Move' },
  { action: 'moveRight', codes: ['ArrowRight', 'KeyD'], label: 'Right', group: 'Move' },
  { action: 'softDrop', codes: ['ArrowDown', 'KeyS'], label: 'Soft drop', group: 'Move' },
  { action: 'hardDrop', codes: ['Space'], label: 'Hard drop', group: 'Move' },

  { action: 'rollClock', codes: ['KeyX', 'ArrowUp'], label: 'Roll', group: 'Rotate' },
  { action: 'rollAnti', codes: ['KeyZ'], label: 'Roll back', group: 'Rotate' },
  { action: 'yawClock', codes: ['KeyE'], label: 'Yaw', group: 'Rotate' },
  { action: 'yawAnti', codes: ['KeyQ'], label: 'Yaw back', group: 'Rotate' },
  { action: 'pitchUp', codes: ['KeyR'], label: 'Pitch', group: 'Rotate' },
  { action: 'pitchDown', codes: ['KeyF'], label: 'Pitch back', group: 'Rotate' },

  {
    action: 'nudgeDeeper',
    codes: ['KeyT'],
    label: 'Push deeper',
    group: 'Depth',
    note: 'From stage 4',
  },
  {
    action: 'nudgeNearer',
    codes: ['KeyG'],
    label: 'Pull nearer',
    group: 'Depth',
    note: 'From stage 4',
  },

  { action: 'hold', codes: ['KeyC', 'ShiftLeft'], label: 'Hold', group: 'Game' },
  { action: 'pause', codes: ['Escape'], label: 'Pause', group: 'Game' },
  { action: 'mute', codes: ['KeyM'], label: 'Mute', group: 'Game' },
  { action: 'restart', codes: ['Enter'], label: 'Play again', group: 'Game', note: 'After a run' },
];

/** `KeyboardEvent.code` to the action it performs. */
export const ACTION_BY_CODE: ReadonlyMap<string, Action> = new Map(
  BINDINGS.flatMap((binding) => binding.codes.map((code) => [code, binding.action] as const))
);

/**
 * How a key is written on screen.
 *
 * Derived from the `code` rather than stored beside it, so a binding change
 * cannot leave a stale caption behind.
 */
export function keyLabel(code: string): string {
  const arrows: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  if (arrows[code]) return arrows[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Escape') return 'Esc';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  return code;
}

/**
 * The turn prompt borrows left and right while it is up.
 *
 * Listed separately because it is not a binding of its own -- it is the movement
 * keys meaning something else for as long as the board is waiting for an answer
 * -- and the key map has to say so, or the player reads "Left: move left" while
 * pressing it turns the board.
 */
export const TURN_PROMPT_NOTE =
  'While the Shift meter is full, Left and Right choose which face comes forward.';

/**
 * The same thing for touch.
 *
 * A separate table rather than a column added to `BINDINGS`, because the two
 * vocabularies do not line up: a keyboard binds a key per direction, and touch
 * gets both directions of roll out of *where* a tap lands. Forcing them into one
 * table would mean inventing rows that do not exist on one side or the other.
 *
 * Read by the settings panel on touch-primary devices, where a key map is no use
 * to anyone. Same contract as the keyboard table: the panel cannot describe a
 * gesture the game does not answer to.
 */
export interface TouchAction {
  readonly gesture: string;
  readonly label: string;
  readonly group: BindingGroup;
  readonly note?: string;
}

export const TOUCH_ACTIONS: readonly TouchAction[] = [
  { gesture: 'Drag sideways', label: 'Move', group: 'Move', note: 'In the bottom strip' },
  { gesture: 'Drag down', label: 'Soft drop', group: 'Move', note: 'In the bottom strip' },
  { gesture: 'Flick down', label: 'Hard drop', group: 'Move', note: 'In the bottom strip' },

  { gesture: 'Tap left', label: 'Roll back', group: 'Rotate', note: 'Above the strip' },
  { gesture: 'Tap right', label: 'Roll', group: 'Rotate', note: 'Above the strip' },
  { gesture: 'Swipe left / right', label: 'Yaw', group: 'Rotate', note: 'Above the strip' },
  { gesture: 'Swipe up / down', label: 'Pitch', group: 'Rotate', note: 'Above the strip' },
];

/** The touch counterpart of `TURN_PROMPT_NOTE`. */
export const TOUCH_TURN_NOTE =
  'While the Shift meter is full, dragging left or right in the strip chooses which face comes forward.';
