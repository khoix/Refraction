/**
 * The touch vocabulary, tested without a browser.
 *
 * The recogniser is pure on purpose: every decision about how a gesture feels is
 * a threshold in one module, so the cases that actually matter -- a flick that
 * should drop versus a drag that should not, a tap that should rotate versus a
 * slip of the thumb that should do nothing -- can be pinned exactly rather than
 * poked at through a device emulator.
 */

import { describe, expect, it } from 'vitest';
import {
  FLING_MIN_PX,
  GestureRecogniser,
  SOFT_DROP_STEP_PX,
  SWIPE_MIN_PX,
  TAP_SLOP_PX,
} from '../../src/touch/gestures';
import type { TouchIntent, TouchLayout } from '../../src/touch/gestures';

/** A 400-wide well from x=100, 600 tall from y=0, strip below it. */
const LAYOUT: TouchLayout = {
  well: { left: 100, top: 0, width: 400, height: 600 },
  stripTop: 600,
  columns: 8,
  // One column of the well: 400 across 8 columns.
  pxPerColumn: 50,
};

const CENTRE = LAYOUT.well.left + LAYOUT.well.width / 2;

/** The same well in a mode with no strip: roll only, so no split. */
const NO_STRIP: TouchLayout = { ...LAYOUT, stripTop: null };

/** Play a gesture through the recogniser and collect everything it emits. */
function play(
  points: readonly [number, number, number][],
  layout: TouchLayout = LAYOUT
): TouchIntent[] {
  const recogniser = new GestureRecogniser();
  const out: TouchIntent[] = [];
  const [first, ...rest] = points;
  const [x0, y0, t0] = first as [number, number, number];
  out.push(...recogniser.begin({ x: x0, y: y0, t: t0 }, layout));
  const last = rest.pop() as [number, number, number];
  for (const [x, y, t] of rest) out.push(...recogniser.move({ x, y, t }, layout));
  out.push(...recogniser.move({ x: last[0], y: last[1], t: last[2] }, layout));
  out.push(...recogniser.end({ x: last[0], y: last[1], t: last[2] }, layout));
  return out;
}

describe('the movement strip', () => {
  it('says nothing on touch down', () => {
    // A press is not a verb. Landing on the strip must not jump the piece
    // before the player has moved, or a thumb resting there teleports it.
    const recogniser = new GestureRecogniser();
    expect(recogniser.begin({ x: 300, y: 640, t: 0 }, LAYOUT)).toEqual([]);
  });

  it('moves the piece by how far the finger travelled, not to where it is', () => {
    // The whole change. A drag of 140px at 50px per column is three columns
    // left, whatever part of the screen it happened over -- the recogniser does
    // not know or care which column the finger is above.
    const intents = play([
      [300, 640, 0],
      [160, 640, 40],
    ]);
    const steps = intents.filter((i) => i.kind === 'columnStep');
    expect(steps.reduce((total, i) => total + (i as { steps: number }).steps, 0)).toBe(-3);
  });

  it('reports each change once, rather than the running total every sample', () => {
    // Emitting the total each time would step the piece by the total each time,
    // so a smooth drag would accelerate away from the finger.
    const intents = play([
      [300, 640, 0],
      [250, 640, 40],
      [200, 640, 80],
      [150, 640, 120],
    ]);
    const steps = intents
      .filter((i) => i.kind === 'columnStep')
      .map((i) => (i as { steps: number }).steps);
    expect(steps).toEqual([-1, -1, -1]);
  });

  it('starts from wherever the finger lands, so the same drag means the same thing', () => {
    // Two drags of identical shape, a long way apart on screen. Under the old
    // absolute mapping these asked for different columns; now they must ask for
    // the same movement, which is what lets a player lift and re-place a thumb.
    const near = play([
      [140, 640, 0],
      [240, 640, 60],
    ]);
    const far = play([
      [420, 640, 0],
      [520, 640, 60],
    ]);
    const total = (intents: TouchIntent[]): number =>
      intents
        .filter((i) => i.kind === 'columnStep')
        .reduce((sum, i) => sum + (i as { steps: number }).steps, 0);
    expect(total(near)).toBe(2);
    expect(total(far)).toBe(2);
  });

  it('says nothing when the finger is put down somewhere new', () => {
    // Lifting and re-placing is the gesture this exists for. Touching down must
    // emit nothing at all, however far the new point is from the old one.
    const recogniser = new GestureRecogniser();
    recogniser.begin({ x: 140, y: 640, t: 0 }, LAYOUT);
    recogniser.move({ x: 240, y: 640, t: 50 }, LAYOUT);
    recogniser.end({ x: 240, y: 640, t: 60 }, LAYOUT);
    expect(recogniser.begin({ x: 700, y: 640, t: 200 }, LAYOUT)).toEqual([]);
  });

  it('reverses immediately, however far the finger overshot', () => {
    // This is what makes a wall harmless without any special handling. A finger
    // dragged well past the edge of the board emits its steps as it goes; the
    // piece takes what it can and the rest are dropped. Coming back one column
    // emits exactly one step the other way, with no debt to work off first.
    //
    // An explicit re-anchor was written for this and turned out to be dead code:
    // it is the *delta* that makes it true, and reporting a running target is
    // the only thing that would break it.
    const recogniser = new GestureRecogniser();
    recogniser.begin({ x: 500, y: 640, t: 0 }, LAYOUT);
    recogniser.move({ x: 100, y: 640, t: 40 }, LAYOUT);
    const back = recogniser.move({ x: 150, y: 640, t: 80 }, LAYOUT);
    expect(back).toContainEqual({ kind: 'columnStep', steps: 1 });
  });

  it('scales with the travel distance the layout asks for', () => {
    // The sensitivity setting reaches the recogniser as `pxPerColumn` and
    // nothing else, so this is the whole of its behaviour.
    const twiceAsSensitive: TouchLayout = { ...LAYOUT, pxPerColumn: 25 };
    const intents = play(
      [
        [300, 640, 0],
        [200, 640, 40],
      ],
      twiceAsSensitive
    );
    const steps = intents
      .filter((i) => i.kind === 'columnStep')
      .reduce((sum, i) => sum + (i as { steps: number }).steps, 0);
    expect(steps).toBe(-4);
  });

  it('ignores a movement too small to be meant', () => {
    const intents = play([
      [300, 640, 0],
      [300 + TAP_SLOP_PX - 2, 640, 30],
    ]);
    expect(intents.filter((i) => i.kind === 'columnStep')).toHaveLength(0);
  });

  it('soft drops a step at a time as the finger travels down', () => {
    const intents = play([
      [300, 620, 0],
      [300, 620 + SOFT_DROP_STEP_PX * 3 + 2, 400],
    ]);
    expect(intents.filter((i) => i.kind === 'softDrop')).toHaveLength(3);
  });

  it('does not take the soft drops back when the finger comes up again', () => {
    // Gravity is not reversible, so dragging back up must not undo it -- but it
    // must re-arm, so a down-up-down drag keeps dropping.
    const intents = play([
      [300, 620, 0],
      [300, 620 + SOFT_DROP_STEP_PX + 1, 100],
      [300, 620, 200],
      [300, 620 + SOFT_DROP_STEP_PX + 1, 300],
    ]);
    expect(intents.filter((i) => i.kind === 'softDrop')).toHaveLength(2);
  });

  it('drops the piece on a flick', () => {
    const intents = play([
      [300, 620, 0],
      [300, 620 + FLING_MIN_PX + 10, 90],
    ]);
    expect(intents.some((i) => i.kind === 'hardDrop')).toBe(true);
  });

  it('does not drop the piece on a slow drag of the same distance', () => {
    // The whole difference between the two is time. A player easing the piece
    // down must not have it slammed for travelling far enough.
    const intents = play([
      [300, 620, 0],
      [300, 620 + FLING_MIN_PX + 10, 900],
    ]);
    expect(intents.some((i) => i.kind === 'hardDrop')).toBe(false);
    expect(intents.some((i) => i.kind === 'softDrop')).toBe(true);
  });

  it('does not drop the piece on a sideways drag that sags', () => {
    const intents = play([
      [300, 620, 0],
      [140, 620 + FLING_MIN_PX + 4, 90],
    ]);
    expect(intents.some((i) => i.kind === 'hardDrop')).toBe(false);
  });
});

describe('the field above the strip', () => {
  it('rolls on a tap, choosing its direction from where the tap lands', () => {
    // Roll is the rotation used constantly, so it cannot carry the latency of a
    // double tap or the dwell of a long press. Splitting the field at the
    // well's centre gives both directions at no cost.
    const left = play([
      [CENTRE - 80, 300, 0],
      [CENTRE - 80, 300, 60],
    ]);
    const right = play([
      [CENTRE + 80, 300, 0],
      [CENTRE + 80, 300, 60],
    ]);
    expect(left).toEqual([{ kind: 'rotate', axis: 'roll', clockwise: false }]);
    expect(right).toEqual([{ kind: 'rotate', axis: 'roll', clockwise: true }]);
  });

  it('yaws on a sideways swipe', () => {
    const intents = play([
      [300, 300, 0],
      [300 + SWIPE_MIN_PX + 10, 300, 120],
    ]);
    expect(intents).toEqual([{ kind: 'rotate', axis: 'yaw', clockwise: true }]);
  });

  it('pitches on an up or down swipe', () => {
    const up = play([
      [300, 300, 0],
      [300, 300 - SWIPE_MIN_PX - 10, 120],
    ]);
    const down = play([
      [300, 300, 0],
      [300, 300 + SWIPE_MIN_PX + 10, 120],
    ]);
    expect(up).toEqual([{ kind: 'rotate', axis: 'pitch', clockwise: true }]);
    expect(down).toEqual([{ kind: 'rotate', axis: 'pitch', clockwise: false }]);
  });

  it('resolves a diagonal to one axis rather than to both or neither', () => {
    const intents = play([
      [300, 300, 0],
      [300 + SWIPE_MIN_PX + 30, 300 + SWIPE_MIN_PX + 5, 120],
    ]);
    expect(intents).toHaveLength(1);
    expect((intents[0] as { axis: string }).axis).toBe('yaw');
  });

  it('never moves the piece, however far the swipe travels', () => {
    // The zoning is the whole point: a gesture that starts above the strip
    // cannot move the piece, so a rotation can be as long as it likes without
    // dragging the piece across the board on its way.
    const intents = play([
      [300, 300, 0],
      [460, 300, 120],
    ]);
    expect(intents.some((i) => i.kind === 'columnStep')).toBe(false);
  });

  it('ignores a tap that is really a slow rest of the thumb', () => {
    const intents = play([
      [300, 300, 0],
      [300, 300, 900],
    ]);
    expect(intents).toHaveLength(0);
  });
});

describe('a cancelled gesture', () => {
  it('leaves nothing behind to land later', () => {
    const recogniser = new GestureRecogniser();
    recogniser.begin({ x: 300, y: 640, t: 0 }, LAYOUT);
    recogniser.cancel();
    expect(recogniser.move({ x: 160, y: 640, t: 40 }, LAYOUT)).toEqual([]);
    expect(recogniser.end({ x: 160, y: 640, t: 80 }, LAYOUT)).toEqual([]);
  });
});

/**
 * A mode with no strip.
 *
 * The field/strip split exists to carry three rotation axes. A mode that permits
 * only roll -- Flatland -- has one, and the strip stops being a convenience and
 * starts being dedicated screen space taken out of an eighteen-row well for a
 * verb the mode does not have. So it goes: drag anywhere to move, fling anywhere
 * to drop, tap anywhere to roll.
 *
 * The two zones do not merely merge, which is why this is a null rather than a
 * strip pushed off the top of the screen. A tap means something different in
 * each: in the split scheme a tap on the strip is a miss, because the strip is
 * where the hand rests and resting a thumb must not roll the piece. With no
 * split there is nowhere to rest that is not the playfield, so a tap is the roll.
 */
describe('a mode with no strip', () => {
  it('moves the piece from a drag anywhere, not just along the bottom', () => {
    // High above where the strip would have been -- in the split scheme this is
    // the field, and a sideways drag here would have been a yaw.
    const intents = play(
      [
        [140, 200, 0],
        [200, 202, 40],
        [380, 204, 90],
      ],
      NO_STRIP
    );
    const columns = intents.filter((intent) => intent.kind === 'columnStep');
    expect(columns.length).toBeGreaterThan(0);
    expect(intents.some((intent) => intent.kind === 'rotate')).toBe(false);
  });

  it('rolls from a tap anywhere, including where the strip would have been', () => {
    const low = play(
      [
        [400, 640, 0],
        [401, 641, 60],
      ],
      NO_STRIP
    );
    expect(low).toEqual([{ kind: 'rotate', axis: 'roll', clockwise: true }]);

    // And the same tap in the split scheme is a miss, which is the behaviour
    // this must not have quietly changed.
    const split = play([
      [400, 640, 0],
      [401, 641, 60],
    ]);
    expect(split).toEqual([]);
  });

  it('takes its roll direction from which side of the well the tap lands', () => {
    const left = play(
      [
        [CENTRE - 60, 300, 0],
        [CENTRE - 59, 301, 50],
      ],
      NO_STRIP
    );
    expect(left).toEqual([{ kind: 'rotate', axis: 'roll', clockwise: false }]);
  });

  it('drops from a fling anywhere', () => {
    const intents = play(
      [
        [300, 150, 0],
        [302, 150 + FLING_MIN_PX + 10, 90],
      ],
      NO_STRIP
    );
    expect(intents.some((intent) => intent.kind === 'hardDrop')).toBe(true);
  });

  it('never emits the rotations the mode does not have', () => {
    // A swipe that would be a yaw in the split scheme. The engine would refuse
    // it anyway -- Flatland permits roll alone -- but a recogniser that emits
    // intents the engine throws away is a vocabulary the player can feel
    // reaching for and getting nothing.
    const sideways = play(
      [
        [200, 200, 0],
        [200 + SWIPE_MIN_PX + 40, 202, 120],
      ],
      NO_STRIP
    );
    for (const intent of sideways) {
      expect(intent.kind === 'rotate' && intent.axis !== 'roll').toBe(false);
    }
  });
});
