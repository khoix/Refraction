/**
 * The bindings, as data — two profiles, one resolve path.
 *
 * **roll** (Flatland): arrows + WASD move, Z/X roll, classic soft drop. No
 * depth rotations or nudge in the panel.
 *
 * **full** (every other mode): arrows are left/right/push/pull; Q/E roll;
 * A/D yaw; W/S pitch; mouse drag translates, LMB soft drop, RMB + Space hard
 * drop. Mode-dependent meaning is intentional — remapping in Settings edits
 * each profile separately.
 *
 * One table shape, read by the input controller, the settings remap UI, and
 * the key/touch maps. The panel cannot describe a key the engine does not
 * answer to, because it reads the same resolved rows.
 */

import type { DepthNudgePolicy, RotationPolicy } from '@core/modes';

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
  | 'peek'
  | 'collapse'
  | 'hold'
  | 'pause'
  | 'mute'
  | 'restart';

/** Flatland vs every other shipped mode. */
export type BindingProfile = 'roll' | 'full';

/** Mouse buttons stored like keyboard codes in remaps. */
export type MouseButtonCode = 'Mouse0' | 'Mouse2';

export type BindingCode = string;

export interface Binding {
  readonly action: Action;
  /** `KeyboardEvent.code` and/or `Mouse0` / `Mouse2`, display order. */
  readonly codes: readonly BindingCode[];
  readonly label: string;
  readonly group: BindingGroup;
  readonly note?: string;
  readonly needs?: Capability;
}

export type Capability = 'depthRotation' | 'depthNudge' | 'spectralCollapse';

export type BindingGroup = 'Move' | 'Rotate' | 'Depth' | 'Game';

export const BINDING_GROUPS: readonly BindingGroup[] = ['Move', 'Rotate', 'Depth', 'Game'];

export const ALL_ACTIONS: readonly Action[] = [
  'moveLeft',
  'moveRight',
  'softDrop',
  'hardDrop',
  'rollAnti',
  'rollClock',
  'yawAnti',
  'yawClock',
  'pitchUp',
  'pitchDown',
  'nudgeNearer',
  'nudgeDeeper',
  'peek',
  'collapse',
  'hold',
  'pause',
  'mute',
  'restart',
] as const;

/** Player remaps: only overridden actions need entries. */
export type RemapTable = Partial<Record<Action, readonly BindingCode[]>>;

export interface BindingRemaps {
  readonly roll: RemapTable;
  readonly full: RemapTable;
}

export const EMPTY_REMAPS: BindingRemaps = { roll: {}, full: {} };

/** Keep only known actions from a saved remap blob. */
export function remapFromSave(raw: Readonly<Record<string, readonly string[]>> | undefined): RemapTable {
  if (!raw) return {};
  const table: RemapTable = {};
  for (const action of ALL_ACTIONS) {
    const codes = raw[action];
    if (codes && codes.length > 0) table[action] = [...codes];
  }
  return table;
}

export function remapsFromSave(bindings: {
  readonly roll: Readonly<Record<string, readonly string[]>>;
  readonly full: Readonly<Record<string, readonly string[]>>;
}): BindingRemaps {
  return {
    roll: remapFromSave(bindings.roll),
    full: remapFromSave(bindings.full),
  };
}

interface BindingMeta {
  readonly action: Action;
  readonly label: string;
  readonly group: BindingGroup;
  readonly note?: string;
  readonly needs?: Capability;
}

const BINDING_META: readonly BindingMeta[] = [
  { action: 'moveLeft', label: 'Left', group: 'Move' },
  { action: 'moveRight', label: 'Right', group: 'Move' },
  { action: 'softDrop', label: 'Soft drop', group: 'Move' },
  { action: 'hardDrop', label: 'Hard drop', group: 'Move' },
  { action: 'rollClock', label: 'Roll', group: 'Rotate' },
  { action: 'rollAnti', label: 'Roll back', group: 'Rotate' },
  { action: 'yawClock', label: 'Yaw', group: 'Rotate', needs: 'depthRotation' },
  { action: 'yawAnti', label: 'Yaw back', group: 'Rotate', needs: 'depthRotation' },
  { action: 'pitchUp', label: 'Pitch', group: 'Rotate', needs: 'depthRotation' },
  { action: 'pitchDown', label: 'Pitch back', group: 'Rotate', needs: 'depthRotation' },
  {
    action: 'nudgeDeeper',
    needs: 'depthNudge',
    label: 'Push deeper',
    group: 'Depth',
    note: 'From stage 4',
  },
  {
    action: 'nudgeNearer',
    needs: 'depthNudge',
    label: 'Pull nearer',
    group: 'Depth',
    note: 'From stage 4',
  },
  {
    action: 'peek',
    label: 'Peek — hold to tilt',
    group: 'Depth',
    note: 'Until stage 6',
  },
  {
    action: 'collapse',
    label: 'Spectral Collapse',
    group: 'Game',
    note: 'When the bar is full',
    needs: 'spectralCollapse',
  },
  { action: 'hold', label: 'Hold', group: 'Game' },
  { action: 'pause', label: 'Pause', group: 'Game' },
  { action: 'mute', label: 'Mute', group: 'Game' },
  { action: 'restart', label: 'Play again', group: 'Game', note: 'After a run' },
];

/** Flatland / roll-only defaults (unchanged from the classic map). */
export const DEFAULT_CODES_ROLL: Readonly<Record<Action, readonly BindingCode[]>> = {
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD'],
  softDrop: ['ArrowDown', 'KeyS'],
  hardDrop: ['Space'],
  rollClock: ['KeyX', 'ArrowUp'],
  rollAnti: ['KeyZ'],
  yawClock: ['KeyE'],
  yawAnti: ['KeyQ'],
  pitchUp: ['KeyR'],
  pitchDown: ['KeyF'],
  nudgeDeeper: ['KeyT'],
  nudgeNearer: ['KeyG'],
  peek: ['KeyP'],
  collapse: ['KeyV'],
  hold: ['KeyC', 'ShiftLeft'],
  pause: ['Escape'],
  mute: ['KeyM'],
  restart: ['Enter'],
};

/**
 * Standard / full 3D defaults.
 *
 * Arrows translate (including depth). WASD-adjacent cluster orients the piece.
 * Soft drop is mouse-only by default; Space and right-click hard-drop.
 */
export const DEFAULT_CODES_FULL: Readonly<Record<Action, readonly BindingCode[]>> = {
  moveLeft: ['ArrowLeft'],
  moveRight: ['ArrowRight'],
  softDrop: ['Mouse0'],
  hardDrop: ['Space', 'Mouse2'],
  rollClock: ['KeyE'],
  rollAnti: ['KeyQ'],
  yawClock: ['KeyD'],
  yawAnti: ['KeyA'],
  pitchUp: ['KeyW'],
  pitchDown: ['KeyS'],
  nudgeDeeper: ['ArrowUp'],
  nudgeNearer: ['ArrowDown'],
  peek: ['KeyP'],
  collapse: ['KeyV'],
  hold: ['KeyC', 'ShiftLeft'],
  pause: ['Escape'],
  mute: ['KeyM'],
  restart: ['Enter'],
};

export function defaultCodes(profile: BindingProfile): Readonly<Record<Action, readonly BindingCode[]>> {
  return profile === 'roll' ? DEFAULT_CODES_ROLL : DEFAULT_CODES_FULL;
}

export function profileForMode(mode: { readonly rotation: RotationPolicy }): BindingProfile {
  return mode.rotation === 'roll' ? 'roll' : 'full';
}

/**
 * Merge defaults with saved remaps. Empty remap arrays are ignored (fall back).
 */
export function resolveBindings(
  profile: BindingProfile,
  remaps: RemapTable | undefined = {}
): readonly Binding[] {
  const defaults = defaultCodes(profile);
  return BINDING_META.map((meta) => {
    const override = remaps[meta.action];
    const codes =
      override && override.length > 0 ? [...override] : [...(defaults[meta.action] ?? [])];
    return {
      action: meta.action,
      codes,
      label: meta.label,
      group: meta.group,
      ...(meta.note ? { note: meta.note } : {}),
      ...(meta.needs ? { needs: meta.needs } : {}),
    };
  });
}

/** Build a code → action map; later duplicates win only if we skip conflicts — first wins. */
export function actionByCodeMap(bindings: readonly Binding[]): ReadonlyMap<string, Action> {
  const map = new Map<string, Action>();
  for (const binding of bindings) {
    for (const code of binding.codes) {
      if (!map.has(code)) map.set(code, binding.action);
    }
  }
  return map;
}

/** Whether every code is unique within the table. */
export function bindingCodesUnique(bindings: readonly Binding[]): boolean {
  const codes = bindings.flatMap((b) => b.codes);
  return new Set(codes).size === codes.length;
}

/**
 * Assign `codes` to `action`, clearing those codes from every other action.
 * Returns null if any action would end up with no binding.
 */
export function rebindAction(
  profile: BindingProfile,
  remaps: RemapTable,
  action: Action,
  codes: readonly BindingCode[]
): RemapTable | null {
  if (codes.length === 0) return null;

  const current = resolveBindings(profile, remaps);
  const byAction = new Map<Action, BindingCode[]>(
    current.map((binding) => [binding.action, [...binding.codes]])
  );
  const taken = new Set(codes);

  for (const a of ALL_ACTIONS) {
    if (a === action) continue;
    const existing = byAction.get(a) ?? [];
    byAction.set(
      a,
      existing.filter((c) => !taken.has(c))
    );
  }
  byAction.set(action, [...codes]);

  for (const a of ALL_ACTIONS) {
    if ((byAction.get(a) ?? []).length === 0) return null;
  }

  const trimmed: RemapTable = {};
  const defaults = defaultCodes(profile);
  for (const a of ALL_ACTIONS) {
    const nextCodes = byAction.get(a) ?? [];
    const def = defaults[a];
    if (nextCodes.length === def.length && nextCodes.every((c, i) => c === def[i])) continue;
    trimmed[a] = nextCodes;
  }
  return trimmed;
}

/**
 * @deprecated Prefer resolveBindings — kept as the roll-profile default table
 * shape for older imports during migration of call sites.
 */
export const BINDINGS: readonly Binding[] = resolveBindings('roll');

/** @deprecated Boot-time roll map; live play rebuilds from resolveBindings. */
export const ACTION_BY_CODE: ReadonlyMap<string, Action> = actionByCodeMap(BINDINGS);

export function keyLabel(code: string): string {
  const arrows: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  if (arrows[code]) return arrows[code];
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Escape') return 'Esc';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'Space') return 'Space';
  return code;
}

export const TURN_PROMPT_NOTE =
  'While the Shift meter is full, Left and Right choose which face comes forward.';

export interface TouchAction {
  readonly gesture: string;
  readonly label: string;
  readonly group: BindingGroup;
  readonly note?: string;
  readonly needs?: Capability;
  /** Wording assumes the old field/strip split (Flatland strip notes). */
  readonly stripNote?: boolean;
  /** Only show on this profile; absent means both. */
  readonly profile?: BindingProfile;
}

export const TOUCH_ACTIONS: readonly TouchAction[] = [
  // --- Flatland / roll (no strip) ---
  {
    gesture: 'Drag sideways',
    label: 'Move',
    group: 'Move',
    note: 'Anywhere',
    profile: 'roll',
  },
  {
    gesture: 'Drag down',
    label: 'Soft drop',
    group: 'Move',
    note: 'Locks the lane until you ease up',
    profile: 'roll',
  },
  {
    gesture: 'Flick down',
    label: 'Hard drop',
    group: 'Move',
    note: 'Anywhere',
    profile: 'roll',
  },
  {
    gesture: 'Tap left',
    label: 'Roll back',
    group: 'Rotate',
    note: 'Left of centre',
    profile: 'roll',
  },
  {
    gesture: 'Tap right',
    label: 'Roll',
    group: 'Rotate',
    note: 'Right of centre',
    profile: 'roll',
  },

  // --- Full / standard ---
  {
    gesture: 'Swipe left / right',
    label: 'Move',
    group: 'Move',
    profile: 'full',
  },
  {
    gesture: 'Swipe up / down',
    label: 'Push / pull',
    group: 'Depth',
    note: 'Auto-peeks while dragging',
    needs: 'depthNudge',
    profile: 'full',
  },
  {
    gesture: 'Two-finger swipe down',
    label: 'Soft / hard drop',
    group: 'Move',
    note: 'Faster flick hard-drops',
    profile: 'full',
  },
  {
    gesture: 'Tap corner',
    label: 'Roll',
    group: 'Rotate',
    note: 'Left / right corners',
    profile: 'full',
  },
  {
    gesture: 'Tap side',
    label: 'Yaw',
    group: 'Rotate',
    note: 'Left / right wedges',
    needs: 'depthRotation',
    profile: 'full',
  },
  {
    gesture: 'Tap top / bottom',
    label: 'Pitch',
    group: 'Rotate',
    note: 'Upper / lower wedges',
    needs: 'depthRotation',
    profile: 'full',
  },

  { gesture: 'Press and hold', label: 'Peek', group: 'Depth', note: 'Until stage 6', profile: 'roll' },
  {
    gesture: 'Vertical depth swipe',
    label: 'Peek',
    group: 'Depth',
    note: 'Until stage 6',
    profile: 'full',
  },

  {
    gesture: 'X button',
    label: 'Spectral Collapse',
    group: 'Game',
    note: '(When bar full) Right panel',
    needs: 'spectralCollapse',
  },
  {
    gesture: 'Pause',
    label: 'Pause',
    group: 'Game',
    note: 'Right panel',
  },
];

export function appliesToMode(
  row: { readonly needs?: Capability; readonly profile?: BindingProfile },
  mode: {
    readonly rotation: RotationPolicy;
    readonly depthNudge: DepthNudgePolicy;
    readonly spectralCollapse: boolean;
  }
): boolean {
  const profile = profileForMode(mode);
  if (row.profile !== undefined && row.profile !== profile) return false;
  if (row.needs === 'depthRotation') return mode.rotation === 'all';
  if (row.needs === 'depthNudge') return mode.depthNudge !== 'never';
  if (row.needs === 'spectralCollapse') return mode.spectralCollapse;
  return true;
}

export function appliesToProfile(
  row: { readonly needs?: Capability; readonly profile?: BindingProfile },
  profile: BindingProfile,
  modeCapabilities: {
    readonly depthNudge: DepthNudgePolicy;
    readonly spectralCollapse: boolean;
  }
): boolean {
  if (row.profile !== undefined && row.profile !== profile) return false;
  if (row.needs === 'depthRotation') return profile === 'full';
  if (row.needs === 'depthNudge') {
    return profile === 'full' && modeCapabilities.depthNudge !== 'never';
  }
  if (row.needs === 'spectralCollapse') return modeCapabilities.spectralCollapse;
  return true;
}

/** Representative mode caps for settings tabs (Flatland vs a full mode). */
export function capsForProfile(profile: BindingProfile): {
  readonly rotation: RotationPolicy;
  readonly depthNudge: DepthNudgePolicy;
  readonly spectralCollapse: boolean;
} {
  if (profile === 'roll') {
    return { rotation: 'roll', depthNudge: 'never', spectralCollapse: true };
  }
  return { rotation: 'all', depthNudge: 'always', spectralCollapse: true };
}

export const TOUCH_TURN_NOTE =
  'While the Shift meter is full, swiping left or right chooses which face comes forward.';

export function isMouseCode(code: string): code is MouseButtonCode {
  return code === 'Mouse0' || code === 'Mouse2';
}