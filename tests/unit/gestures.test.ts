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
  columnAt,
} from '../../src/touch/gestures';
import type { TouchIntent, TouchLayout } from '../../src/touch/gestures';

/** A 400-wide well from x=100, 600 tall from y=0, strip below it. */
const LAYOUT: TouchLayout = {
  well: { left: 100, top: 0, width: 400, height: 600 },
  stripTop: 600,
  columns: 8,
};

const CENTRE = LAYOUT.well.left + LAYOUT.well.width / 2;

/** Play a gesture through the recogniser and collect everything it emits. */
function play(points: readonly [number, number, number][]): TouchIntent[] {
  const recogniser = new GestureRecogniser();
  const out: TouchIntent[] = [];
  const [first, ...rest] = points;
  const [x0, y0, t0] = first as [number, number, number];
  out.push(...recogniser.begin({ x: x0, y: y0, t: t0 }, LAYOUT));
  const last = rest.pop() as [number, number, number];
  for (const [x, y, t] of rest) out.push(...recogniser.move({ x, y, t }, LAYOUT));
  out.push(...recogniser.move({ x: last[0], y: last[1], t: last[2] }, LAYOUT));
  out.push(...recogniser.end({ x: last[0], y: last[1], t: last[2] }, LAYOUT));
  return out;
}

describe('where a pointer is', () => {
  it('maps a position across the well to a column', () => {
    expect(columnAt(LAYOUT, 100)).toBe(0);
    expect(columnAt(LAYOUT, 499)).toBe(7);
    expect(columnAt(LAYOUT, 300)).toBe(4);
  });

  it('clamps outside the well rather than running off the board', () => {
    expect(columnAt(LAYOUT, -500)).toBe(0);
    expect(columnAt(LAYOUT, 5000)).toBe(7);
  });
});

describe('the movement strip', () => {
  it('says nothing on touch down', () => {
    // A press is not a verb. Landing on the strip must not jump the piece
    // before the player has moved, or a thumb resting there teleports it.
    const recogniser = new GestureRecogniser();
    expect(recogniser.begin({ x: 300, y: 640, t: 0 }, LAYOUT)).toEqual([]);
  });

  it('moves the piece to the column under the finger, absolutely', () => {
    // Absolute, not accumulated: the column under the finger is the column the
    // piece is in. Starting at column 4 and ending at column 1 must ask for
    // column 1, not for three steps left.
    const intents = play([
      [300, 640, 0],
      [160, 640, 40],
      [155, 640, 80],
    ]);
    const columns = intents.filter((i) => i.kind === 'column');
    expect(columns.length).toBeGreaterThan(0);
    expect(columns[columns.length - 1]).toEqual({ kind: 'column', column: 1 });
  });

  it('ignores a movement too small to be meant', () => {
    const intents = play([
      [300, 640, 0],
      [300 + TAP_SLOP_PX - 2, 640, 30],
    ]);
    expect(intents.filter((i) => i.kind === 'column')).toHaveLength(0);
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
    expect(intents.some((i) => i.kind === 'column')).toBe(false);
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
