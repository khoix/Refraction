/**
 * Touch gesture recognition.
 *
 * Pure: it takes pointer samples and a description of where things are on
 * screen, and returns intents. No DOM, no game, no clock of its own. Everything
 * about how a gesture *feels* -- how far a drag has to travel before it stops
 * being a tap, how fast a fling has to be -- is a named threshold here rather
 * than a number buried in an event handler, which is the only way any of it can
 * be tuned or tested.
 *
 * ## The scheme
 *
 * The screen is split. A narrow strip along the bottom moves the piece;
 * everything above it rotates it. That zoning is what makes the vocabulary work
 * at all: a gesture never has to be disambiguated by what it happens to be near,
 * because the region it starts in already says which verb class it belongs to.
 * It also keeps the thumb off the board -- movement happens below the well, so
 * the hand is never over the thing being aimed.
 *
 * | Gesture                        | Verb                        |
 * | ------------------------------ | --------------------------- |
 * | Drag sideways, in the strip    | Move -- absolute, per column |
 * | Fling down, in the strip       | Hard drop                   |
 * | Drag down, in the strip        | Soft drop                   |
 * | Tap left of centre, above      | Roll anticlockwise          |
 * | Tap right of centre, above     | Roll clockwise              |
 * | Swipe left / right, above      | Yaw                         |
 * | Swipe up / down, above         | Pitch                       |
 *
 * Two decisions in there are worth their reasoning, because the obvious
 * alternatives are worse:
 *
 * **Hard drop is a fling, not a double tap.** A double tap is two taps plus a
 * waiting window, so either the drop waits on the window and feels late, or the
 * first tap fires and every drop rolls the piece on its way down. A fling and a
 * tap differ at the first sample that moves, so neither has to wait on the
 * other.
 *
 * **Roll picks its direction from where the tap lands**, rather than from a
 * double tap or a long press. Roll is the rotation a player uses constantly --
 * it is the screen-plane one, the ordinary falling-block rotate -- so it cannot
 * carry any latency at all. Splitting the field at the well's centre gives both
 * directions for free, at zero cost, and reads naturally: tap left to turn left.
 */

/** Movement below this, in CSS pixels, is still a tap rather than a drag. */
export const TAP_SLOP_PX = 12;
/** A press longer than this is not a tap, even if it never moved. */
export const TAP_MAX_MS = 400;
/** How far a swipe must travel before it is a swipe. */
export const SWIPE_MIN_PX = 30;
/** A fling must travel at least this far downward to drop the piece. */
export const FLING_MIN_PX = 44;
/** ...and arrive within this long, or it is a deliberate drag instead. */
export const FLING_MAX_MS = 320;
/**
 * A gesture has to be clearly more vertical than horizontal to read as a drop
 * rather than as a sloppy sideways drag.
 */
export const FLING_ASPECT = 1.4;
/** Downward travel per soft-drop step while dragging in the strip. */
export const SOFT_DROP_STEP_PX = 22;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TouchLayout {
  /** The well's silhouette, in the same coordinates as the samples. */
  readonly well: Rect;
  /** Pointer y at or below this belongs to the movement strip. */
  readonly stripTop: number;
  readonly columns: number;
}

export interface Sample {
  readonly x: number;
  readonly y: number;
  /** Milliseconds, from any monotonic source. */
  readonly t: number;
}

export type TouchIntent =
  /** Put the piece under this board column. Absolute, not a delta. */
  | { readonly kind: 'column'; readonly column: number }
  | { readonly kind: 'softDrop' }
  | { readonly kind: 'hardDrop' }
  | {
      readonly kind: 'rotate';
      readonly axis: 'roll' | 'yaw' | 'pitch';
      readonly clockwise: boolean;
    };

type Zone = 'strip' | 'field';

interface Active {
  readonly start: Sample;
  readonly zone: Zone;
  /** Furthest down the pointer has been, for soft-drop stepping. */
  softDropAnchor: number;
  /** Set once a gesture has travelled far enough to stop being a tap. */
  moved: boolean;
}

/** Which board column a screen x falls in, clamped to the board. */
export function columnAt(layout: TouchLayout, x: number): number {
  const width = layout.well.width / layout.columns;
  const raw = Math.floor((x - layout.well.left) / Math.max(1, width));
  return Math.min(layout.columns - 1, Math.max(0, raw));
}

export class GestureRecogniser {
  private active: Active | null = null;

  begin(sample: Sample, layout: TouchLayout): TouchIntent[] {
    const zone: Zone = sample.y >= layout.stripTop ? 'strip' : 'field';
    this.active = { start: sample, zone, softDropAnchor: sample.y, moved: false };
    // Deliberately silent. A press is not yet a verb: touching the strip must
    // not jump the piece before the player has moved, or a tap meant for
    // something else teleports it.
    return [];
  }

  move(sample: Sample, layout: TouchLayout): TouchIntent[] {
    const active = this.active;
    if (!active) return [];

    const dx = sample.x - active.start.x;
    const dy = sample.y - active.start.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) active.moved = true;
    if (active.zone !== 'strip' || !active.moved) return [];

    const intents: TouchIntent[] = [{ kind: 'column', column: columnAt(layout, sample.x) }];

    // Soft drop steps as the pointer travels down, and only downward: dragging
    // back up must not undo them, because gravity is not reversible.
    while (sample.y - active.softDropAnchor >= SOFT_DROP_STEP_PX) {
      active.softDropAnchor += SOFT_DROP_STEP_PX;
      intents.push({ kind: 'softDrop' });
    }
    if (sample.y < active.softDropAnchor) active.softDropAnchor = sample.y;

    return intents;
  }

  end(sample: Sample, layout: TouchLayout): TouchIntent[] {
    const active = this.active;
    this.active = null;
    if (!active) return [];

    const dx = sample.x - active.start.x;
    const dy = sample.y - active.start.y;
    const elapsed = sample.t - active.start.t;
    const travelled = Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX;

    if (!travelled) {
      // A tap. Only the field rotates; a tap on the strip is a miss, not a verb,
      // because the strip is where the hand rests.
      if (active.zone !== 'field' || elapsed > TAP_MAX_MS) return [];
      const centre = layout.well.left + layout.well.width / 2;
      return [{ kind: 'rotate', axis: 'roll', clockwise: sample.x >= centre }];
    }

    if (active.zone === 'strip') {
      const fling =
        dy >= FLING_MIN_PX && elapsed <= FLING_MAX_MS && Math.abs(dy) > Math.abs(dx) * FLING_ASPECT;
      return fling ? [{ kind: 'hardDrop' }] : [];
    }

    // A swipe over the field. The dominant axis wins, so a diagonal resolves
    // rather than doing both or neither.
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (Math.abs(dx) < SWIPE_MIN_PX) return [];
      return [{ kind: 'rotate', axis: 'yaw', clockwise: dx > 0 }];
    }
    if (Math.abs(dy) < SWIPE_MIN_PX) return [];
    // Screen y grows downward; swiping up should tip the piece's top away.
    return [{ kind: 'rotate', axis: 'pitch', clockwise: dy < 0 }];
  }

  /** Drop any gesture in progress, e.g. when a menu takes over. */
  cancel(): void {
    this.active = null;
  }
}
