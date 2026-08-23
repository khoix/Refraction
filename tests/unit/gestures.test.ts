/**
 * The touch vocabulary, tested without a browser.
 */

import { describe, expect, it } from 'vitest';
import {
  FLING_MIN_PX,
  GestureRecogniser,
  SOFT_DROP_STEP_PX,
  TAP_SLOP_PX,
} from '../../src/touch/gestures';
import type { TouchIntent, TouchLayout } from '../../src/touch/gestures';
import {
  ZONE_ORDER,
  ZONE_POLYGONS,
  classifyNormalized,
  hitWedge,
  pointInPolygon,
  wedgeLayout,
} from '../../src/touch/wedges';

const VIEW = { width: 400, height: 700 };

const ROLL: TouchLayout = {
  well: { left: 100, top: 0, width: 400, height: 600 },
  stripTop: null,
  columns: 8,
  pxPerColumn: 50,
  scheme: 'roll',
  viewport: VIEW,
};

const CENTRE = ROLL.well.left + ROLL.well.width / 2;

const FULL: TouchLayout = {
  ...ROLL,
  scheme: 'full',
  viewport: { width: 400, height: 800 },
};

function play(
  points: readonly [number, number, number][],
  layout: TouchLayout = ROLL
): TouchIntent[] {
  const recogniser = new GestureRecogniser();
  const out: TouchIntent[] = [];
  const [first, ...rest] = points;
  const [x0, y0, t0] = first as [number, number, number];
  out.push(...recogniser.begin({ x: x0, y: y0, t: t0, id: 1 }, layout));
  const last = rest.pop() as [number, number, number];
  for (const [x, y, t] of rest) out.push(...recogniser.move({ x, y, t, id: 1 }, layout));
  out.push(...recogniser.move({ x: last[0], y: last[1], t: last[2], id: 1 }, layout));
  out.push(...recogniser.end({ x: last[0], y: last[1], t: last[2], id: 1 }, layout));
  return out;
}

describe('Flatland / roll scheme', () => {
  it('says nothing on touch down', () => {
    const recogniser = new GestureRecogniser();
    expect(recogniser.begin({ x: 300, y: 640, t: 0 }, ROLL)).toEqual([]);
  });

  it('moves the piece by how far the finger travelled', () => {
    const intents = play([
      [300, 640, 0],
      [160, 640, 40],
    ]);
    const steps = intents.filter((i) => i.kind === 'columnStep');
    expect(steps.reduce((total, i) => total + (i as { steps: number }).steps, 0)).toBe(-3);
  });

  it('soft-drops as the finger travels down', () => {
    const intents = play([
      [300, 400, 0],
      [300, 400 + SOFT_DROP_STEP_PX * 2, 80],
    ]);
    expect(intents.filter((i) => i.kind === 'softDrop')).toHaveLength(2);
  });

  it('hard-drops on a downward fling', () => {
    const intents = play([
      [300, 400, 0],
      [300, 400 + FLING_MIN_PX, 100],
    ]);
    expect(intents.some((i) => i.kind === 'hardDrop')).toBe(true);
  });

  it('rolls on a tap, choosing direction from where it lands', () => {
    const left = play([
      [CENTRE - 40, 200, 0],
      [CENTRE - 40, 200, 50],
    ]);
    const right = play([
      [CENTRE + 40, 200, 0],
      [CENTRE + 40, 200, 50],
    ]);
    expect(left).toEqual([{ kind: 'rotate', axis: 'roll', clockwise: false }]);
    expect(right).toEqual([{ kind: 'rotate', axis: 'roll', clockwise: true }]);
  });

  it('ignores a slip smaller than the tap slop as still a tap', () => {
    const intents = play([
      [300, 200, 0],
      [300 + TAP_SLOP_PX - 1, 200, 40],
      [300 + TAP_SLOP_PX - 1, 200, 80],
    ]);
    expect(intents.some((i) => i.kind === 'rotate')).toBe(true);
  });
});

describe('full scheme', () => {
  it('swipes sideways to move and vertically to nudge', () => {
    const intents = play(
      [
        [200, 400, 0],
        [200 + 100, 400 - 50, 80],
      ],
      FULL
    );
    expect(intents.some((i) => i.kind === 'columnStep')).toBe(true);
    expect(intents.some((i) => i.kind === 'laneStep')).toBe(true);
    expect(intents.some((i) => i.kind === 'peek' && i.held)).toBe(true);
  });

  it('releases peek when the finger lifts', () => {
    const intents = play(
      [
        [200, 400, 0],
        [200, 350, 80],
      ],
      FULL
    );
    expect(intents.filter((i) => i.kind === 'peek').map((i) => (i as { held: boolean }).held)).toEqual([
      true,
      false,
    ]);
  });

  it('rotates from a wedge tap in W', () => {
    // Normalized (0.5, 0.14) → W → pitch up. Viewport 400×800.
    const intents = play(
      [
        [200, 112, 0],
        [200, 112, 50],
      ],
      FULL
    );
    expect(intents).toEqual([{ kind: 'rotate', axis: 'pitch', clockwise: true }]);
  });
});

describe('normalized touch-zone polygons', () => {
  it('returns dead zone for the centre', () => {
    expect(classifyNormalized(0.5, 0.5)).toBe('DEAD_ZONE');
    const layout = wedgeLayout(400, 800);
    expect(hitWedge(200, 400, layout)).toBeNull();
  });

  it('maps authored samples to the correct wedges', () => {
    const layout = wedgeLayout(1000, 1000);
    // Pixel = normalized * 1000
    expect(hitWedge(120, 100, layout)).toBe('rollAnti'); // Q top-left ~ (0.12, 0.10)
    expect(hitWedge(880, 100, layout)).toBe('rollClock'); // E top-right
    expect(hitWedge(500, 140, layout)).toBe('pitchUp'); // W
    expect(hitWedge(500, 880, layout)).toBe('pitchDown'); // S
    expect(hitWedge(100, 500, layout)).toBe('yawAnti'); // A
    expect(hitWedge(900, 500, layout)).toBe('yawClock'); // D
    expect(hitWedge(120, 900, layout)).toBe('rollAnti'); // Q bottom-left
    expect(hitWedge(880, 900, layout)).toBe('rollClock'); // E bottom-right
  });

  it('classifies every zone’s centroid to that zone', () => {
    expect(classifyNormalized(0.12, 0.1)).toBe('Q_TOP_LEFT');
    expect(classifyNormalized(0.88, 0.1)).toBe('E_TOP_RIGHT');
    expect(classifyNormalized(0.5, 0.14)).toBe('W');
    expect(classifyNormalized(0.1, 0.5)).toBe('A');
    expect(classifyNormalized(0.5, 0.5)).toBe('DEAD_ZONE');
    expect(classifyNormalized(0.9, 0.5)).toBe('D');
    expect(classifyNormalized(0.5, 0.88)).toBe('S');
    expect(classifyNormalized(0.12, 0.9)).toBe('Q_BOTTOM_LEFT');
    expect(classifyNormalized(0.88, 0.9)).toBe('E_BOTTOM_RIGHT');
  });

  it('handles shared edges deterministically via ZONE_ORDER', () => {
    // Dead-zone top edge shared with W — dead wins (first in order).
    expect(classifyNormalized(0.5, 0.42)).toBe('DEAD_ZONE');
    // Q_TOP_LEFT / W shared-ish around TL (0.35, 0) — Q listed before W.
    expect(classifyNormalized(0.35, 0)).toBe('Q_TOP_LEFT');
  });

  it('covers a dense grid with no unclassified interior gaps', () => {
    const step = 0.02;
    let misses = 0;
    for (let x = 0; x <= 1; x += step) {
      for (let y = 0; y <= 1; y += step) {
        if (classifyNormalized(x, y) === null) misses += 1;
      }
    }
    expect(misses).toBe(0);
  });

  it('exports every polygon for the diagram in ZONE_ORDER', () => {
    expect(ZONE_ORDER).toHaveLength(9);
    for (const id of ZONE_ORDER) {
      expect(ZONE_POLYGONS[id].length).toBeGreaterThanOrEqual(3);
      expect(pointInPolygon(0.5, 0.5, ZONE_POLYGONS.DEAD_ZONE)).toBe(true);
    }
  });
});
