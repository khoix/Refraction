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
import type { DepthNudgePolicy, RotationPolicy } from '@core/modes';

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
  | 'peek'
  | 'collapse'
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
  /**
   * What the mode has to permit for this row to mean anything.
   *
   * A mode can withhold a verb outright -- Flatland permits roll alone and never
   * offers the depth nudge -- and a controls panel that lists a key the engine
   * ignores is exactly the drift a shared table exists to prevent. Absent means
   * the control is always available.
   */
  readonly needs?: Capability;
}

/**
 * A capability a mode may or may not offer.
 *
 * Named for the verb rather than for the field it is read from, because the two
 * tables here are read by both a keyboard panel and a touch panel and neither
 * should have to know how a mode stores its policy.
 */
export type Capability = 'depthRotation' | 'depthNudge' | 'spectralCollapse';

export type BindingGroup = 'Move' | 'Rotate' | 'Depth' | 'Game';

export const BINDING_GROUPS: readonly BindingGroup[] = ['Move', 'Rotate', 'Depth', 'Game'];

/*
 * `V` for Spectral Collapse.
 *
 * Chosen for where it sits rather than for what it spells: the left hand already
 * covers `Z` and `X` for roll and `C` for hold, and `V` is the next key along.
 * The alternative was a mnemonic somewhere the hand is not, which is the wrong
 * trade for an action taken under pressure. `W` was free and is deliberately
 * left alone -- M11c has it becoming half the depth cluster.
 */
export const BINDINGS: readonly Binding[] = [
  { action: 'moveLeft', codes: ['ArrowLeft', 'KeyA'], label: 'Left', group: 'Move' },
  { action: 'moveRight', codes: ['ArrowRight', 'KeyD'], label: 'Right', group: 'Move' },
  { action: 'softDrop', codes: ['ArrowDown', 'KeyS'], label: 'Soft drop', group: 'Move' },
  { action: 'hardDrop', codes: ['Space'], label: 'Hard drop', group: 'Move' },

  { action: 'rollClock', codes: ['KeyX', 'ArrowUp'], label: 'Roll', group: 'Rotate' },
  { action: 'rollAnti', codes: ['KeyZ'], label: 'Roll back', group: 'Rotate' },
  { action: 'yawClock', codes: ['KeyE'], label: 'Yaw', group: 'Rotate', needs: 'depthRotation' },
  {
    action: 'yawAnti',
    codes: ['KeyQ'],
    label: 'Yaw back',
    group: 'Rotate',
    needs: 'depthRotation',
  },
  { action: 'pitchUp', codes: ['KeyR'], label: 'Pitch', group: 'Rotate', needs: 'depthRotation' },
  {
    action: 'pitchDown',
    codes: ['KeyF'],
    label: 'Pitch back',
    group: 'Rotate',
    needs: 'depthRotation',
  },

  {
    action: 'nudgeDeeper',
    needs: 'depthNudge',
    codes: ['KeyT'],
    label: 'Push deeper',
    group: 'Depth',
    note: 'From stage 4',
  },
  {
    action: 'nudgeNearer',
    needs: 'depthNudge',
    codes: ['KeyG'],
    label: 'Pull nearer',
    group: 'Depth',
    note: 'From stage 4',
  },

  {
    action: 'peek',
    codes: ['KeyP'],
    label: 'Peek — hold to tilt',
    group: 'Depth',
    note: 'Until stage 6',
  },

  {
    action: 'collapse',
    codes: ['KeyV'],
    label: 'Spectral Collapse',
    group: 'Game',
    note: 'When the bar is full',
    needs: 'spectralCollapse',
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
  /** As `Binding.needs`. */
  readonly needs?: Capability;
  /**
   * True for rows whose wording assumes the field/strip split.
   *
   * A roll-only mode has no strip, so "in the bottom strip" and "above the
   * strip" describe a screen that is not there. The row still applies -- the
   * verb exists -- but its note does not, and a note that points at a region the
   * player cannot find is worse than none.
   */
  readonly stripNote?: boolean;
}

export const TOUCH_ACTIONS: readonly TouchAction[] = [
  {
    gesture: 'Drag sideways',
    label: 'Move',
    group: 'Move',
    note: 'In the bottom strip',
    stripNote: true,
  },
  {
    gesture: 'Drag down',
    label: 'Soft drop',
    group: 'Move',
    note: 'In the bottom strip',
    stripNote: true,
  },
  {
    gesture: 'Flick down',
    label: 'Hard drop',
    group: 'Move',
    note: 'In the bottom strip',
    stripNote: true,
  },

  {
    gesture: 'Tap left',
    label: 'Roll back',
    group: 'Rotate',
    note: 'Above the strip',
    stripNote: true,
  },
  {
    gesture: 'Tap right',
    label: 'Roll',
    group: 'Rotate',
    note: 'Above the strip',
    stripNote: true,
  },
  {
    gesture: 'Swipe left / right',
    label: 'Yaw',
    group: 'Rotate',
    note: 'Above the strip',
    stripNote: true,
    needs: 'depthRotation',
  },
  {
    gesture: 'Swipe up / down',
    label: 'Pitch',
    group: 'Rotate',
    note: 'Above the strip',
    stripNote: true,
    needs: 'depthRotation',
  },

  { gesture: 'Press and hold', label: 'Peek', group: 'Depth', note: 'Until stage 6' },

  {
    gesture: 'Tap the gauge',
    label: 'Spectral Collapse',
    group: 'Game',
    note: 'When it is full',
    needs: 'spectralCollapse',
  },
];

/**
 * Whether a mode answers to this row at all.
 *
 * One predicate, read by both panels, so the keyboard map and the touch map
 * cannot disagree about what a mode offers.
 */
export function appliesToMode(
  row: { readonly needs?: Capability },
  mode: {
    readonly rotation: RotationPolicy;
    readonly depthNudge: DepthNudgePolicy;
    readonly spectralCollapse: boolean;
  }
): boolean {
  if (row.needs === 'depthRotation') return mode.rotation === 'all';
  if (row.needs === 'depthNudge') return mode.depthNudge !== 'never';
  if (row.needs === 'spectralCollapse') return mode.spectralCollapse;
  return true;
}

/** The touch counterpart of `TURN_PROMPT_NOTE`. */
export const TOUCH_TURN_NOTE =
  'While the Shift meter is full, dragging left or right in the strip chooses which face comes forward.';
